const axios = require('axios');
const { recordUsage, markSuccess } = require('../llm-status');

const SAMBANOVA_URL = process.env.SAMBANOVA_URL || 'https://api.sambanova.ai/v1';

function getApiKey() {
  return process.env.SAMBANOVA_API_KEY;
}

async function callSambaNova(messages, model, options = {}) {
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('SAMBANOVA_API_KEY tidak ditemukan di .env');
  }

  try {
    const response = await axios.post(
      `${SAMBANOVA_URL}/chat/completions`,
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
      throw new Error('SambaNova tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('sambanova', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('sambanova', model, { lastError: null });

    return text;
  } catch (error) {
    if (error.response?.status === 429) {
      const retryAfter = error.response?.headers?.['retry-after'];
      const err = new Error(
        `SambaNova rate limit: ${error.response?.data?.error?.message || 'unknown'}`
      );
      err.quota = true;
      err.retryAfter = retryAfter ? Number(retryAfter) : null;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  callSambaNova,
};
