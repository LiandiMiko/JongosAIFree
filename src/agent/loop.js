const { callLLM } = require('../providers');
const { buildAgentSystemPrompt, parseAgentResponse } = require('./decision');
const { validateAgentAction, executeAction } = require('./tool-executor');
const { retrieveContext, indexVault } = require('../rag');

const MUTATING_VAULT_TOOLS = [
  'obsidian-create',
  'obsidian-update',
  'obsidian-append',
  'obsidian-delete',
  'obsidian-move',
  'obsidian-normalize',
  'obsidian-organize',
];

/**
 * Multi-step agent loop.
 * Returns either a final answer string OR a structured approval object:
 *   { status: 'answered', answer: string }
 *   { status: 'approval_required', requestId, tool, args, policy, message, continuation }
 *   { status: 'error', message: string }
 */
async function runAgentLoop(userMessage, config = {}, meta = {}) {
  const maxSteps = config.maxSteps || 5;
  const agentName = config.agentName || 'Paijo';
  const userId = meta.userId || 'anonymous';

  let ragContext = '';
  let ragUsed = false;

  try {
    ragContext = retrieveContext(userMessage, 3);
    if (ragContext) ragUsed = true;
  } catch (err) {
    console.log('[rag] Skipped context retrieval:', err.message);
  }

  let systemPrompt = buildAgentSystemPrompt(agentName, ragUsed);
  if (ragContext) {
    systemPrompt += `\n\n${ragContext}`;
  }

  // Support continuation after approval
  const priorHistory = Array.isArray(meta.history) ? meta.history : [];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...priorHistory,
    { role: 'user', content: userMessage },
  ];

  // If continuing after tool result
  if (meta.toolResult) {
    messages.push({
      role: 'user',
      content: `Hasil eksekusi tool ${meta.toolResult.tool}:\n${meta.toolResult.output}`,
    });
  }

  let toolsUsed = Array.isArray(meta.toolsUsed) ? [...meta.toolsUsed] : [];
  let step = Number.isInteger(meta.step) ? meta.step : 0;

  while (step < maxSteps) {
    step++;
    console.log(`[agent-loop] Step ${step}/${maxSteps}`);

    let rawResponse;
    try {
      rawResponse = await callLLM(messages, config, { json: true });
    } catch (err) {
      console.error(`[agent-loop] LLM Call error at step ${step}:`, err.message);
      return {
        status: 'error',
        message: `Maaf, terjadi masalah pada koneksi AI: ${err.message}`,
      };
    }

    const parsed = parseAgentResponse(rawResponse);
    const validation = validateAgentAction(parsed);

    if (!validation.valid) {
      console.log(`[agent-loop] Invalid response: ${validation.reason}`);
      messages.push({ role: 'assistant', content: rawResponse });
      messages.push({
        role: 'user',
        content: `Sistem Error: Response tidak valid. ${validation.reason}. Tolong perbaiki format JSON kamu.`,
      });
      continue;
    }

    if (parsed.action === 'final') {
      console.log(`[agent-loop] Final answer reached at step ${step}`);
      const vaultToolsUsed = toolsUsed.filter((t) => t.startsWith('obsidian-'));
      const footer = buildSourceFooter(ragUsed, vaultToolsUsed);
      return {
        status: 'answered',
        answer: `${parsed.reply}\n\n${footer}`,
      };
    }

    if (parsed.action === 'tool') {
      console.log(`[agent-loop] Executing tool: ${parsed.tool}`);
      toolsUsed.push(parsed.tool);

      const result = await executeAction(parsed, {
        ...meta,
        userId,
        userText: userMessage,
        history: messages.slice(1), // exclude system
        step,
        config,
        source: meta.source || 'agent',
      });

      if (result.status === 'approval_required') {
        return {
          status: 'approval_required',
          requestId: result.requestId,
          tool: result.tool,
          args: result.args,
          policy: result.policy,
          message: result.message,
          continuation: {
            userText: userMessage,
            history: messages.slice(1),
            step,
            toolsUsed,
            ragUsed,
          },
        };
      }

      if (result.status === 'blocked') {
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `Eksekusi Tool Ditolak: ${result.error}`,
        });
        continue;
      }

      if (result.status === 'error') {
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `Error tool ${parsed.tool}: ${result.error}`,
        });
        continue;
      }

      // success — auto reindex vault if needed
      if (MUTATING_VAULT_TOOLS.includes(parsed.tool)) {
        try {
          indexVault();
        } catch (rErr) {
          console.log('[rag] Auto reindex after mutation error:', rErr.message);
        }
      }

      const outputText = result.output || '(No output)';
      messages.push({ role: 'assistant', content: rawResponse });
      messages.push({
        role: 'user',
        content: `Hasil eksekusi tool ${parsed.tool}:\n${outputText}`,
      });
    }
  }

  return {
    status: 'error',
    message: 'Maaf, batas maksimum langkah (max steps) tercapai sebelum mendapat jawaban akhir.',
  };
}

function buildSourceFooter(ragContextInjected, vaultToolsUsed) {
  const parts = [];

  if (vaultToolsUsed.length > 0) {
    const toolNames = [...new Set(vaultToolsUsed)].join(', ');
    parts.push(`📂 **Sumber: Vault Obsidian** _(tools: ${toolNames})_`);
  } else if (ragContextInjected) {
    parts.push(`📂 **Sumber: Vault Obsidian (RAG)** _— konteks otomatis dari vault digunakan_`);
  } else {
    parts.push(`🌐 **Sumber: Pengetahuan Umum AI** _— tidak ada data dari vault yang digunakan_`);
  }

  return `---\n${parts.join(' · ')}`;
}

module.exports = {
  runAgentLoop,
};
