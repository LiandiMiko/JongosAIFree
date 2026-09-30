const axios = require('axios');
const { recordUsage, markSuccess, markRateLimited } = require('../llm-status');

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions';

function getApiKey() {
  return process.env.MISTRAL_API_KEY;
}

function isQuotaError(status, data) {
  const msg = (data?.error?.message || JSON.stringify(data || {})).toLowerCase();
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('resource exhausted') ||
    msg.includes('too many requests') ||
    (msg.includes('tokens') && msg.includes('limit'))
  );
}

async function callMistral(messages, model, options = {}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY tidak ditemukan di .env');
  }

  try {
    const response = await axios.post(
      MISTRAL_URL,
      {
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('Mistral tidak mengembalikan response.');
    }

    const headers = response.headers || {};
    const limit = headers['x-ratelimit-limit'] ? Number(headers['x-ratelimit-limit']) : null;
    const remaining = headers['x-ratelimit-remaining'] ? Number(headers['x-ratelimit-remaining']) : null;
    const reset = headers['x-ratelimit-reset'] ? Number(headers['x-ratelimit-reset']) : null;

    const usage = response.data?.usage || {};

    recordUsage('mistral', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('mistral', model, {
      limit,
      remaining,
      used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
      resetAt: reset ? new Date(reset > 100000000000 ? reset : reset * 1000).toISOString() : null,
    });

    return text;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      if (status === 401 || status === 403) {
        throw new Error(`Mistral API key ditolak (${status}).`);
      }

      if (isQuotaError(status, data)) {
        const headers = error.response.headers || {};
        const limit = headers['x-ratelimit-limit'] ? Number(headers['x-ratelimit-limit']) : null;
        const remaining = headers['x-ratelimit-remaining'] ? Number(headers['x-ratelimit-remaining']) : null;
        const reset = headers['x-ratelimit-reset'] ? Number(headers['x-ratelimit-reset']) : null;

        markRateLimited('mistral', model, {
          limit,
          remaining,
          used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
          resetAt: reset ? new Date(reset > 100000000000 ? reset : reset * 1000).toISOString() : null,
          lastError: data?.error?.message || 'Mistral rate limit/quota',
        });

        const err = new Error(`Model ${model} Mistral sedang limit/quota habis`);
        err.quota = true;
        throw err;
      }

      throw new Error(`Mistral API error (${status}): ${data?.error?.message || 'Unknown error'}`);
    }

    throw new Error(`Gagal menghubungi Mistral: ${error.message}`);
  }
}

module.exports = {
  callMistral,
};
