const { callLLM } = require('../providers');
const { buildAgentSystemPrompt, parseAgentResponse } = require('./decision');
const { validateAgentAction, executeAction } = require('./tool-executor');

async function runAgentLoop(userMessage, config = {}, meta = {}) {
  const maxSteps = config.maxSteps || 5;
  const agentName = config.agentName || 'Paijo';

  const systemPrompt = buildAgentSystemPrompt(agentName);

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
