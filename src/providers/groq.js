const axios = require('axios');
const { recordUsage, markSuccess, markRateLimited } = require('../llm-status');

const GROQ_URL = process.env.GROQ_URL || 'https://api.groq.com/openai/v1';

function getApiKey() {
  return process.env.GROQ_API_KEY;
}

async function callGroq(messages, model, options = {}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('GROQ_API_KEY tidak ditemukan di .env');
  }

  try {
    const response = await axios.post(
      `${GROQ_URL}/chat/completions`,
      {
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
        ...(options.json ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 60000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('Groq tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('groq', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('groq', model, { lastError: null });

    return text;
  } catch (error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'];
      const err = new Error(
        `Groq rate limit: ${error.response?.data?.error?.message || 'unknown'}`
      );
      err.quota = true;
      err.retryAfter = retryAfter ? Number(retryAfter) : null;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  callGroq,
};
