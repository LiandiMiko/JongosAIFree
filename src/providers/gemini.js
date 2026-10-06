const axios = require('axios');
const { recordUsage, markSuccess, markRateLimited } = require('../llm-status');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

function getGeminiApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY,
  ].filter(Boolean);

  return [...new Set(keys)];
}

function buildGeminiRequest(messages, options = {}) {
  const systemMessages = messages.filter(
    (message) => message.role === 'system'
  );

  const normalMessages = messages.filter(
    (message) => message.role !== 'system'
  );

  const contents = normalMessages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [
      {
        text: String(message.content || ''),
      },
    ],
  }));

  // FIX Q4: Gemini API returns 400 if contents is empty (system-only messages)
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Mulai.' }] });
  }

  // FIX Q3: Respect caller-provided options instead of hardcoded values
  const generationConfig = {
    maxOutputTokens: options.maxTokens || options.max_tokens || 2048,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
  };

  if (options.json) {
    generationConfig.responseMimeType = 'application/json';
  }

  const body = {
    contents,
    generationConfig,
  };

  if (systemMessages.length > 0) {
    body.systemInstruction = {
      parts: [
        {
          text: systemMessages
            .map((message) => String(message.content || ''))
            .join('\n\n'),
        },
      ],
    };
  }

  return body;
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

async function callGemini(messages, model, options = {}) {
  const apiKeys = getGeminiApiKeys();

  if (apiKeys.length === 0) {
    throw new Error('Tidak ada GEMINI_API_KEY_1/_2/_3 di .env');
  }

  let lastQuotaError = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    const keyNumber = i + 1;

    const url = `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;

    try {
      console.log(`[llm] Gemini key #${keyNumber} → ${model}`);

      const response = await axios.post(
        url,
        buildGeminiRequest(messages, options),
        {
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        }
      );

      const parts = response.data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((part) => part.text || '').join('').trim();

      if (!text) {
        throw new Error('Gemini tidak mengembalikan response.');
      }

      console.log(`[llm] Gemini key #${keyNumber} berhasil`);

      const usage = response.data?.usageMetadata || {};

      recordUsage(
        'gemini',
        model,
        {
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount,
        },
        keyNumber
      );

      markSuccess(
        'gemini',
        model,
        { lastError: null },
        keyNumber
      );

      return text;
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (isQuotaError(status, data)) {
          const violation = data?.error?.details
            ?.find((item) => item?.['@type']?.includes('QuotaFailure'))
            ?.violations?.[0];

          const retryInfo = data?.error?.details
            ?.find((item) => item?.['@type']?.includes('RetryInfo'));

          const limit = violation?.quotaValue != null ? Number(violation.quotaValue) : null;

          let retryAfter = null;
          if (retryInfo?.retryDelay) {
            const raw = String(retryInfo.retryDelay).trim();
            const val = Number.parseFloat(raw);
            if (!Number.isNaN(val)) {
              if (raw.endsWith('ms')) retryAfter = val / 1000;
              else retryAfter = val;
            }
          }

          if (retryAfter === null) {
            const fallback = String(data?.error?.message || '').match(/retry in ([\d.]+)(ms|s)\b/i);
            if (fallback) {
              const v = Number.parseFloat(fallback[1]);
              retryAfter = fallback[2].toLowerCase() === 'ms' ? v / 1000 : v;
            }
          }

          const rawMessage = data?.error?.message || 'Gemini rate limit/quota';
          const message = rawMessage.replace(/\s+/g, ' ').slice(0, 200);

          markRateLimited(
            'gemini',
            model,
            {
              limit,
              remaining: 0,
              used: limit,
              retryAfter,
              lastError: message,
            },
            keyNumber
          );

          lastQuotaError = new Error(`Gemini key #${keyNumber} terkena limit/quota`);
          console.log(`[llm] Gemini key #${keyNumber} limit → coba key berikutnya...`);
          continue;
        }

        if (status === 401 || status === 403) {
          console.log(`[llm] Gemini key #${keyNumber} ditolak (${status}) → coba key berikutnya...`);
          continue;
        }

        const err = new Error(
          `Gemini API error (${status}): ${data?.error?.message || 'Unknown error'}`
        );
        err.response = error.response;
        err.statusCode = status;
        throw err;
      }

      throw new Error(`Gagal menghubungi Gemini: ${error.message}`);
    }
  }

  throw lastQuotaError || new Error('Semua Gemini API key tidak dapat digunakan.');
}

module.exports = {
  callGemini,
};
