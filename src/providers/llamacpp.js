const axios = require('axios');
const { recordUsage, markSuccess } = require('../llm-status');

const LLAMACPP_URL = process.env.LLAMACPP_URL || 'http://127.0.0.1:8080/v1';

function getApiKey() {
  return process.env.LLAMACPP_API_KEY || 'local';
}

function sanitizeForLlamaCpp(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: 'Halo' }];
  }

  const out = [];
  const systems = messages.filter((m) => m.role === 'system' && m.content);
  if (systems.length > 0) {
    out.push({
      role: 'system',
      content: systems.map((s) => String(s.content)).join('\n\n'),
    });
  }

  const rest = messages.filter((m) => m.role !== 'system' && m.content);

  for (const msg of rest) {
    const content = String(msg.content);
    if (!content.trim()) continue;

    const last = out[out.length - 1];

    if (last && last.role === msg.role) {
      last.content += '\n\n' + content;
      continue;
    }

    const lastNonSystem = out.filter((m) => m.role !== 'system').pop();
    if (msg.role === 'assistant' && !lastNonSystem) continue;

    out.push({ role: msg.role, content });
  }

  while (out.length > 0 && out[out.length - 1].role === 'assistant') {
    out.pop();
  }

  if (!out.some((m) => m.role === 'user')) {
    out.push({ role: 'user', content: 'Halo' });
  }

  return out;
}

async function callLlamaCpp(messages, model, options = {}) {
  const apiKey = getApiKey();
  const cleanMessages = sanitizeForLlamaCpp(messages);
  const originalCount = Array.isArray(messages) ? messages.length : 0;
  if (cleanMessages.length !== originalCount) {
    console.log(
      `[llamacpp] Sanitized messages: ${originalCount} → ${cleanMessages.length}`
    );
  }

  try {
    const response = await axios.post(
      `${LLAMACPP_URL}/chat/completions`,
      {
        model,
        messages: cleanMessages,
        max_tokens: 2048,
        temperature: 0.7,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && apiKey !== 'local' ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        timeout: 180000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('llama.cpp tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('llamacpp', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('llamacpp', model, { lastError: null });

    return text;
  } catch (error) {
    if (error.response) {
      console.error(
        '[llamacpp] 400 body:',
        JSON.stringify(error.response.data).slice(0, 500)
      );
    }
    if (
      error.code === 'ECONNREFUSED' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'
    ) {
      throw new Error(`llama.cpp tidak bisa dijangkau: ${error.message}`);
    }
    throw error;
  }
}

module.exports = {
  callLlamaCpp,
  sanitizeForLlamaCpp,
};
