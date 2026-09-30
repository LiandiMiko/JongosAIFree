const axios = require('axios');
const { recordUsage, markSuccess } = require('../llm-status');

const LLM7_URL = process.env.LLM7_URL || 'https://api.llm7.io/v1';

function getApiKey() {
  const key = process.env.LLM7_API_KEY;
  if (!key || !String(key).trim()) {
    throw new Error('LLM7_API_KEY tidak ada di .env — provider ini dilewati');
  }
  return String(key).trim();
}

async function callLLM7(messages, model, options = {}) {
  const apiKey = getApiKey();

  try {
    const response = await axios.post(
      `${LLM7_URL}/chat/completions`,
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
      throw new Error('LLM7 tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('llm7', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('llm7', model, { lastError: null });

    return text;
  } catch (error) {
    if (error.response?.status === 402) {
      const err = new Error('LLM7 insufficient balance');
      err.quota = true;
      throw err;
    }
    if (error.response?.status === 429) {
      const err = new Error('LLM7 rate limit');
      err.quota = true;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  callLLM7,
};
