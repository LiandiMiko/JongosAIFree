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

/**
 * FIX C4: Safely parse rate-limit reset header.
 * Handles relative seconds (< year 2001 epoch), unix seconds, unix ms, ISO strings.
 * Returns null instead of crashing with RangeError on invalid values.
 */
function parseResetAt(raw) {
  if (!raw) return null;
  const num = Number(raw);
  if (!Number.isNaN(num) && num > 0) {
    // If value < year 2001 epoch (~978307200), treat as relative seconds from now
    // This fixes the 1970 epoch semantic bug (small values like 60 → 1970-01-01)
    const ms = num < 978307200 ? Date.now() + num * 1000
      : num > 1e11 ? num   // already ms
      : num * 1000;        // seconds → ms
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
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
        max_tokens: options.maxTokens || options.max_tokens || 2048,
        temperature: options.temperature !== undefined ? options.temperature : 0.7,
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
      resetAt: parseResetAt(headers['x-ratelimit-reset']),
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

        markRateLimited('mistral', model, {
          limit,
          remaining,
          used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
          resetAt: parseResetAt(headers['x-ratelimit-reset']),
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
