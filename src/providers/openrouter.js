const axios = require('axios');
const { recordUsage, markSuccess, markRateLimited } = require('../llm-status');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(messages, model, options = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY tidak ditemukan di .env');

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
          'HTTP-Referer': 'https://github.com/LiandiMiko/JongosAIFree',
          'X-Title': 'JongosAIFree',
        },
        timeout: 60000,
      }
    );

    const text = response.data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('OpenRouter tidak mengembalikan response.');

    const usage = response.data?.usage || {};
    recordUsage('openrouter', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });
    markSuccess('openrouter', model, { lastError: null });

    return text;
  } catch (error) {
    if (error.response?.status === 429) {
      const err = new Error(`OpenRouter rate limit: ${error.response?.data?.error?.message || 'unknown'}`);
      err.quota = true;
      throw err;
    }
    throw error;
  }
}

module.exports = { callOpenRouter };
