const { callLLM } = require('../providers');
const { buildAgentSystemPrompt, parseAgentResponse } = require('./decision');
const { validateAgentAction, executeAction } = require('./tool-executor');
const { retrieveContext, indexVault } = require('../rag');

async function runAgentLoop(userMessage, config = {}, meta = {}) {
  const maxSteps = config.maxSteps || 5;
  const agentName = config.agentName || 'Paijo';

  let systemPrompt = buildAgentSystemPrompt(agentName);

  // Auto RAG context injection
  try {
    const ragContext = retrieveContext(userMessage, 3);
    if (ragContext) {
      systemPrompt += `\n\n${ragContext}`;
    }
  } catch (err) {
    console.log('[rag] Skipped context retrieval:', err.message);
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

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
      return parsed.reply;
    }

    if (parsed.action === 'tool') {
      console.log(`[agent-loop] Executing tool: ${parsed.tool}`);
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

module.exports = {
  runAgentLoop,
};
