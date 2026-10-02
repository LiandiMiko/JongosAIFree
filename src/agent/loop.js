const { callLLM } = require('../providers');
const {
  buildAgentSystemPrompt,
  parseAgentResponse,
  classifyIntent,
} = require('./decision');
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

/** Max chars of tool output fed back into the LLM (keeps context small). */
const MAX_TOOL_OUTPUT_CHARS = 4000;

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

  const intent = classifyIntent(userMessage);
  console.log(
    `[agent-loop] Intent: ${intent.type} (${intent.confidence}) skipRag=${intent.skipRag}`
  );

  let ragContext = '';
  let ragUsed = false;

  if (intent.skipRag) {
    console.log(`[rag] Skip RAG — intent=${intent.type}`);
  } else {
    try {
      ragContext = retrieveContext(userMessage, 3);
      if (ragContext) ragUsed = true;
    } catch (err) {
      console.log('[rag] Skipped context retrieval:', err.message);
    }
  }

  // Fast-path: pure time questions — no LLM tool loop needed for clock
  // (still use LLM for natural phrasing would be nicer, but server time in prompt is enough;
  // we let LLM answer with final using server time in system prompt)

  let systemPrompt = buildAgentSystemPrompt(agentName, ragUsed, {
    intent,
    realtimeMode: intent.type === 'realtime',
  });
  if (ragContext && !intent.skipRag) {
    systemPrompt += `\n\n${ragContext}`;
  }

  const priorHistory = Array.isArray(meta.history) ? meta.history : [];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...priorHistory,
    { role: 'user', content: userMessage },
  ];

  if (meta.toolResult) {
    messages.push({
      role: 'user',
      content: `Hasil eksekusi tool ${meta.toolResult.tool}:\n${truncateOutput(meta.toolResult.output)}`,
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
      const footer = buildSourceFooter({
        ragUsed,
        toolsUsed,
        intent,
      });
      return {
        status: 'answered',
        answer: `${parsed.reply}\n\n${footer}`,
        intent,
        toolsUsed,
      };
    }

    if (parsed.action === 'tool') {
      // Soft policy: reject tools blocked by intent before execution
      if (
        Array.isArray(intent.blockTools) &&
        intent.blockTools.includes(parsed.tool)
      ) {
        console.log(
          `[agent-loop] Blocked tool "${parsed.tool}" by intent policy (${intent.type})`
        );
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content:
            `Eksekusi Tool Ditolak: Tool "${parsed.tool}" tidak diizinkan untuk intent "${intent.type}". ` +
            (intent.preferTools?.length
              ? `Gunakan salah satu: ${intent.preferTools.join(', ')}.`
              : 'Jawab final langsung jika memungkinkan.'),
        });
        continue;
      }

      console.log(`[agent-loop] Executing tool: ${parsed.tool}`);
      toolsUsed.push(parsed.tool);

      const result = await executeAction(parsed, {
        ...meta,
        userId,
        userText: userMessage,
        history: messages.slice(1),
        step,
        config,
        source: meta.source || 'agent',
        intent,
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
            intent,
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

      if (MUTATING_VAULT_TOOLS.includes(parsed.tool)) {
        try {
          indexVault();
        } catch (rErr) {
          console.log('[rag] Auto reindex after mutation error:', rErr.message);
        }
      }

      const outputText = truncateOutput(result.output || '(No output)');
      messages.push({ role: 'assistant', content: rawResponse });
      messages.push({
        role: 'user',
        content: `Hasil eksekusi tool ${parsed.tool}:\n${outputText}`,
      });
    }
  }

  return {
    status: 'error',
    message:
      'Maaf, batas maksimum langkah (max steps) tercapai sebelum mendapat jawaban akhir.',
  };
}

function truncateOutput(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_TOOL_OUTPUT_CHARS) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT_CHARS) +
    `\n… [output dipotong ${s.length - MAX_TOOL_OUTPUT_CHARS} karakter]`
  );
}

/**
 * Consistent source footer based on tools actually used + RAG.
 */
function buildSourceFooter({ ragUsed, toolsUsed, intent }) {
  const unique = [...new Set(toolsUsed || [])];
  const vaultTools = unique.filter((t) => t.startsWith('obsidian-'));
  const usedFetch = unique.includes('fetch');
  const usedShell = unique.includes('shell');
  const otherTools = unique.filter(
    (t) => !t.startsWith('obsidian-') && t !== 'fetch' && t !== 'shell'
  );

  const parts = [];

  if (vaultTools.length > 0) {
    parts.push(`📂 **Vault** _(tools: ${vaultTools.join(', ')})_`);
  } else if (ragUsed) {
    parts.push(`📂 **Vault (RAG)**`);
  }

  if (usedFetch) {
    parts.push(`🌐 **Fetch**`);
  }
  if (usedShell) {
    parts.push(`💻 **Shell**`);
  }
  if (otherTools.length > 0) {
    parts.push(`🔧 **Tool:** ${otherTools.join(', ')}`);
  }

  if (parts.length === 0) {
    if (intent && (intent.type === 'time' || intent.type === 'status')) {
      parts.push(
        intent.type === 'time'
          ? `🕐 **Waktu server**`
          : `📊 **Status provider**`
      );
    } else {
      parts.push(`🧠 **AI** _— tanpa vault/fetch_`);
    }
  }

  return `---\n${parts.join(' · ')}`;
}

module.exports = {
  runAgentLoop,
  buildSourceFooter,
  truncateOutput,
  classifyIntent,
};
