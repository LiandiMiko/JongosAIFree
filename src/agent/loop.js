const { callLLM } = require('../providers');
const { buildAgentSystemPrompt, parseAgentResponse } = require('./decision');
const { validateAgentAction, executeAction } = require('./tool-executor');
const { retrieveContext, indexVault } = require('../rag');

async function runAgentLoop(userMessage, config = {}, meta = {}) {
  const maxSteps = config.maxSteps || 5;
  const agentName = config.agentName || 'Paijo';

  let ragContext = '';
  let ragUsed = false;

  // Auto RAG context injection
  try {
    ragContext = retrieveContext(userMessage, 3);
    if (ragContext) {
      ragUsed = true;
    }
  } catch (err) {
    console.log('[rag] Skipped context retrieval:', err.message);
  }

  let systemPrompt = buildAgentSystemPrompt(agentName, ragUsed);

  if (ragContext) {
    systemPrompt += `\n\n${ragContext}`;
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  let toolsUsed = [];
  let step = 0;

  while (step < maxSteps) {
    step++;
    console.log(`[agent-loop] Step ${step}/${maxSteps}`);

    let rawResponse;
    try {
      rawResponse = await callLLM(messages, config, { json: true });
    } catch (err) {
      console.error(`[agent-loop] LLM Call error at step ${step}:`, err.message);
      return `Maaf, terjadi masalah pada koneksi AI: ${err.message}`;
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

      // Build source tag footer
      const vaultToolsUsed = toolsUsed.filter((t) => t.startsWith('obsidian-'));
      const footer = buildSourceFooter(ragUsed, vaultToolsUsed);

      return `${parsed.reply}\n\n${footer}`;
    }

    if (parsed.action === 'tool') {
      console.log(`[agent-loop] Executing tool: ${parsed.tool}`);
      toolsUsed.push(parsed.tool);

      const result = await executeAction(parsed, meta);

      if (result.status === 'approval_required') {
        return result.message;
      }

      // Auto-reindex RAG store after vault mutations
      if (
        result.status === 'success' &&
        parsed.tool.startsWith('obsidian-') &&
        ['obsidian-create', 'obsidian-update', 'obsidian-append', 'obsidian-delete', 'obsidian-move', 'obsidian-normalize'].includes(parsed.tool)
      ) {
        try {
          indexVault();
        } catch (rErr) {
          console.log('[rag] Auto reindex after mutation error:', rErr.message);
        }
      }

      if (result.status === 'blocked') {
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `Eksekusi Tool Ditolak: ${result.error}`,
        });
        continue;
      }

      const outputText = result.status === 'success' ? result.output : `Error: ${result.error}`;
      messages.push({ role: 'assistant', content: rawResponse });
      messages.push({
        role: 'user',
        content: `Hasil eksekusi tool ${parsed.tool}:\n${outputText}`,
      });
    }
  }

  return 'Maaf, batas maksimum langkah perbaikan (max steps) tercapai sebelum mendapat jawaban akhir.';
}

/**
 * Build a source indicator footer for the user
 */
function buildSourceFooter(ragContextInjected, vaultToolsUsed) {
  const parts = [];

  if (vaultToolsUsed.length > 0) {
    // Actively read/searched vault via tools
    const toolNames = [...new Set(vaultToolsUsed)].join(', ');
    parts.push(`📂 **Sumber: Vault Obsidian** _(tools: ${toolNames})_`);
  } else if (ragContextInjected) {
    // Got context from RAG index (passive injection)
    parts.push(`📂 **Sumber: Vault Obsidian (RAG)** _— konteks otomatis dari vault digunakan_`);
  } else {
    // Pure LLM general knowledge
    parts.push(`🌐 **Sumber: Pengetahuan Umum AI** _— tidak ada data dari vault yang digunakan_`);
  }

  return `---\n${parts.join(' · ')}`;
}

module.exports = {
  runAgentLoop,
};
