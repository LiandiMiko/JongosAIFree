const axios = require('axios');
const { recordUsage, markSuccess, markRateLimited } = require('../llm-status');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getApiKey() {
  return process.env.OPENROUTER_API_KEY;
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

async function callOpenRouter(messages, model, options = {}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY tidak ditemukan di .env');
  }

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model,
        messages,
        max_tokens: 2048,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/joymadhu49/clawd-agent',
          'X-Title': 'Clawd Agent',
        },
        timeout: 90000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('OpenRouter tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('openrouter', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    const headers = response.headers || {};
    const limit = headers['x-ratelimit-limit'] ? Number(headers['x-ratelimit-limit']) : null;
    const remaining = headers['x-ratelimit-remaining'] ? Number(headers['x-ratelimit-remaining']) : null;
    const reset = headers['x-ratelimit-reset'] ? Number(headers['x-ratelimit-reset']) : null;

    markSuccess('openrouter', model, {
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

      if (status === 401) {
        throw new Error('OpenRouter API key tidak valid.');
      }

      if (isQuotaError(status, data)) {
        const responseHeaders = error.response.headers || {};
        const quotaHeaders = data?.error?.metadata?.headers || {};
        const limitRaw = responseHeaders['x-ratelimit-limit'] || quotaHeaders['X-RateLimit-Limit'];
        const remainingRaw = responseHeaders['x-ratelimit-remaining'] || quotaHeaders['X-RateLimit-Remaining'];
        const resetRaw = responseHeaders['x-ratelimit-reset'] || quotaHeaders['X-RateLimit-Reset'];
        const limit = limitRaw != null ? Number(limitRaw) : null;
        const remaining = remainingRaw != null ? Number(remainingRaw) : null;
        const reset = resetRaw != null ? Number(resetRaw) : null;
        const message = data?.error?.message || 'OpenRouter rate limit/quota';

        markRateLimited('openrouter', model, {
          limit,
          remaining,
          used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
          resetAt: reset ? new Date(reset > 100000000000 ? reset : reset * 1000).toISOString() : null,
          lastError: message,
        });

        const err = new Error(`Model ${model} OpenRouter sedang limit/quota habis`);
        err.quota = true;
        throw err;
      }

      throw new Error(`OpenRouter API error (${status}): ${data?.error?.message || 'Unknown error'}`);
    }

    throw new Error(`Gagal menghubungi OpenRouter: ${error.message}`);
  }
}

module.exports = {
  callOpenRouter,
};
