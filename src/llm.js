require("dotenv").config();
const axios = require('axios');
const { markSuccess, markRateLimited, markError, recordUsage } = require('./llm-status');
const { scanMessages, formatDetections } = require('./secret-scanner');
const { isRateLimited } = require('./llm-status');

const PROVIDERS = {
  gemini: {
    name: 'Google Gemini',
    models: [
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite',
    ],
  },

  openrouter: {
    name: 'OpenRouter',
    models: [
      'openrouter/free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'meta-llama/llama-3.3-70b-instruct:free',
      'deepseek/deepseek-r1-0528:free',
      'google/gemma-3-27b-it:free',
      'qwen/qwen3-coder:free',
      'mistralai/mistral-small-3.1-24b-instruct:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'openai/gpt-oss-120b:free',
    ],
  },

  mistral: {
    name: 'Mistral AI',
    models: [
      'mistral-small-latest',
    ],
  },
};

const GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const OPENROUTER_URL =
  'https://openrouter.ai/api/v1/chat/completions';

const MISTRAL_URL =
  'https://api.mistral.ai/v1/chat/completions';


function getModels(provider) {
  return PROVIDERS[provider]?.models || [];
}


function getGeminiApiKeys() {
  const keys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
  ].filter(Boolean);

  return [...new Set(keys)];
}

function getApiKey(provider) {
  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
  };

  return keys[provider];
}


function isQuotaError(status, data) {
  const msg = (
    data?.error?.message ||
    JSON.stringify(data || {})
  ).toLowerCase();

  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('resource exhausted') ||
    msg.includes('too many requests') ||
    msg.includes('tokens') && msg.includes('limit')
  );
}


/* =========================
   GEMINI
========================= */

function buildGeminiRequest(messages) {
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

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
    },
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


async function callGemini(messages, model) {
  const apiKeys = getGeminiApiKeys();

  if (apiKeys.length === 0) {
    throw new Error(
      'Tidak ada GEMINI_API_KEY_1/_2/_3 di .env'
    );
  }

  let lastQuotaError = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    const keyNumber = i + 1;

    const url =
      `${GEMINI_BASE_URL}/` +
      `${encodeURIComponent(model)}:generateContent`;

    try {
      console.log(
        `[llm] Gemini key #${keyNumber} → ${model}`
      );

      const response = await axios.post(
        url,
        buildGeminiRequest(messages),
        {
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          timeout: 90000,
        }
      );

      const parts =
        response.data?.candidates?.[0]?.content?.parts || [];

      const text = parts
        .map((part) => part.text || '')
        .join('')
        .trim();

      if (!text) {
        throw new Error(
          'Gemini tidak mengembalikan response.'
        );
      }

      console.log(
        `[llm] Gemini key #${keyNumber} berhasil`
      );

      const usage = response.data?.usageMetadata || {};

      recordUsage("gemini", model, {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
        totalTokens: usage.totalTokenCount,
      });

      markSuccess("gemini", model, {
        lastError: null,
      });

      return text;

    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (isQuotaError(status, data)) {
          const violation =
            data?.error?.details
              ?.find((item) => item?.["@type"]?.includes("QuotaFailure"))
              ?.violations?.[0];

          const retryInfo =
            data?.error?.details
              ?.find((item) => item?.["@type"]?.includes("RetryInfo"));

          const limit = violation?.quotaValue != null
            ? Number(violation.quotaValue)
            : null;

          const retryAfter = retryInfo?.retryDelay
            ? Number.parseFloat(retryInfo.retryDelay)
            : null;

          const message =
            data?.error?.message || "Gemini rate limit/quota";

          markRateLimited("gemini", model, {
            limit,
            remaining: 0,
            used: limit,
            retryAfter,
            lastError: message,
          });

          lastQuotaError = new Error(
            `Gemini key #${keyNumber} terkena limit/quota`
          );

          console.log(
            `[llm] Gemini key #${keyNumber} limit → coba key berikutnya...`
          );

          continue;
        }

        if (status === 401 || status === 403) {
          console.log(
            `[llm] Gemini key #${keyNumber} ditolak (${status}) → coba key berikutnya...`
          );

          continue;
        }

        throw new Error(
          `Gemini API error (${status}): ${
            data?.error?.message || 'Unknown error'
          }`
        );
      }

      throw new Error(
        `Gagal menghubungi Gemini: ${error.message}`
      );
    }
  }

  throw (
    lastQuotaError ||
    new Error(
      'Semua Gemini API key tidak dapat digunakan.'
    )
  );
}


/* =========================
   OPENROUTER
========================= */

async function callOpenRouter(messages, model) {
  const apiKey = getApiKey('openrouter');

  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY tidak ditemukan di .env'
    );
  }

  try {
    const response = await axios.post(
      OPENROUTER_URL,
      {
        model,
        messages,
        max_tokens: 2048,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer':
            'https://github.com/joymadhu49/clawd-agent',
          'X-Title': 'Clawd Agent',
        },
        timeout: 90000,
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content
        ?.trim();

    if (!text) {
      throw new Error(
        'OpenRouter tidak mengembalikan response.'
      );
    }

    const usage = response.data?.usage || {};

    recordUsage("openrouter", model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    const headers = response.headers || {};
    const limit = headers["x-ratelimit-limit"] ? Number(headers["x-ratelimit-limit"]) : null;
    const remaining = headers["x-ratelimit-remaining"] ? Number(headers["x-ratelimit-remaining"]) : null;
    const reset = headers["x-ratelimit-reset"] ? Number(headers["x-ratelimit-reset"]) : null;

    markSuccess("openrouter", model, {
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
        throw new Error(
          'OpenRouter API key tidak valid.'
        );
      }

      if (isQuotaError(status, data)) {
        const responseHeaders = error.response.headers || {};
        const quotaHeaders = data?.error?.metadata?.headers || {};
        const limitRaw = responseHeaders["x-ratelimit-limit"] || quotaHeaders["X-RateLimit-Limit"];
        const remainingRaw = responseHeaders["x-ratelimit-remaining"] || quotaHeaders["X-RateLimit-Remaining"];
        const resetRaw = responseHeaders["x-ratelimit-reset"] || quotaHeaders["X-RateLimit-Reset"];
        const limit = limitRaw != null ? Number(limitRaw) : null;
        const remaining = remainingRaw != null ? Number(remainingRaw) : null;
        const reset = resetRaw != null ? Number(resetRaw) : null;
        const message = data?.error?.message || "OpenRouter rate limit/quota";

        markRateLimited("openrouter", model, {
          limit,
          remaining,
          used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
          resetAt: reset ? new Date(reset > 100000000000 ? reset : reset * 1000).toISOString() : null,
          lastError: message,
        });

        const err = new Error(
          `Model ${model} OpenRouter sedang limit/quota habis`
        );

        err.quota = true;
        throw err;
      }

      throw new Error(
        `OpenRouter API error (${status}): ${
          data?.error?.message || 'Unknown error'
        }`
      );
    }

    throw new Error(
      `Gagal menghubungi OpenRouter: ${error.message}`
    );
  }
}


/* =========================
   MISTRAL
========================= */

async function callMistral(messages, model) {
  const apiKey = getApiKey('mistral');

  if (!apiKey) {
    throw new Error(
      'MISTRAL_API_KEY tidak ditemukan di .env'
    );
  }

  try {
    const response = await axios.post(
      MISTRAL_URL,
      {
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 90000,
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content
        ?.trim();

    if (!text) {
      throw new Error(
        'Mistral tidak mengembalikan response.'
      );
    }

    const headers = response.headers || {};
    const limit = headers["x-ratelimit-limit"] ? Number(headers["x-ratelimit-limit"]) : null;
    const remaining = headers["x-ratelimit-remaining"] ? Number(headers["x-ratelimit-remaining"]) : null;
    const reset = headers["x-ratelimit-reset"] ? Number(headers["x-ratelimit-reset"]) : null;

    const usage = response.data?.usage || {};

    recordUsage("mistral", model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess("mistral", model, {
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
        throw new Error(
          `Mistral API key ditolak (${status}).`
        );
      }

      if (isQuotaError(status, data)) {
        const headers = error.response.headers || {};
        const limit = headers["x-ratelimit-limit"] ? Number(headers["x-ratelimit-limit"]) : null;
        const remaining = headers["x-ratelimit-remaining"] ? Number(headers["x-ratelimit-remaining"]) : null;
        const reset = headers["x-ratelimit-reset"] ? Number(headers["x-ratelimit-reset"]) : null;

        markRateLimited("mistral", model, {
          limit,
          remaining,
          used: limit !== null && remaining !== null ? Math.max(0, limit - remaining) : null,
          resetAt: reset ? new Date(reset > 100000000000 ? reset : reset * 1000).toISOString() : null,
          lastError: data?.error?.message || "Mistral rate limit/quota",
        });

        const err = new Error(
          `Model ${model} Mistral sedang limit/quota habis`
        );

        err.quota = true;
        throw err;
      }

      throw new Error(
        `Mistral API error (${status}): ${
          data?.error?.message || 'Unknown error'
        }`
      );
    }

    throw new Error(
      `Gagal menghubungi Mistral: ${error.message}`
    );
  }
}


/* =========================
   MAIN LLM ROUTER
========================= */

async function callLLM(messages, config) {
  // === Secret Scanner (Layer 1) ===
  const scan = scanMessages(messages);
  if (scan.detections.length > 0) {
    console.log(
      '[privacy] Secret detected & redacted:',
      formatDetections(scan.detections)
    );
    for (const d of scan.detections) {
      console.log(
        `[privacy]   msg#${d.index} (${d.role}) → ${d.type}${d.key ? ' (' + d.key + ')' : ''} ${d.preview}`
      );
    }
    messages = scan.messages;
  }
  // === end Secret Scanner ===

  const primaryProvider =
    (config.provider || 'gemini').toLowerCase();

  const providerOrder = [
    primaryProvider,
    ...Object.keys(PROVIDERS).filter(
      (provider) => provider !== primaryProvider
    ),
  ];

  // === Rate-limit aware routing ===
  const available = [];
  const skipped = [];

  for (const provider of providerOrder) {
    const models = getModels(provider);
    if (!models.length) continue;

    const model =
      provider === primaryProvider &&
      models.includes(config.model)
        ? config.model
        : models[0];

    if (isRateLimited(provider, model)) {
      skipped.push({ provider, model });
      console.log(
        `[llm] Skipping ${provider}/${model} (rate-limited)`
      );
    } else {
      available.push({ provider, model });
    }
  }

  if (available.length === 0 && skipped.length > 0) {
    console.log(
      '[llm] Semua provider rate-limited — mencoba sebagai last resort...'
    );
  }

  const attemptOrder = [...available, ...skipped];
  // === end Rate-limit aware routing ===

  let lastError = null;

  for (const { provider, model } of attemptOrder) {
    console.log(
      `[llm] Trying provider: ${provider} | model: ${model}`
    );

    try {
      if (provider === 'gemini') {
        return await callGemini(messages, model);
      }

      if (provider === 'openrouter') {
        return await callOpenRouter(messages, model);
      }

      if (provider === 'mistral') {
        return await callMistral(messages, model);
      }

      throw new Error(
        `Provider ${provider} belum memiliki adapter.`
      );

    } catch (error) {
      lastError = error;

      const isQuota =
        error.quota === true ||
        error.response?.status === 429 ||
        /quota|rate limit|limit|429/i.test(
          error.message || ''
        );

      if (isQuota) {
        console.log(
          `[llm] ${provider}/${model} limit → fallback ke provider berikutnya...`
        );
        continue;
      }

      console.log(
        `[llm] ${provider}/${model} gagal: ${error.message}`
      );

      continue;
    }
  }

  throw (
    lastError ||
    new Error(
      'Semua provider AI sedang tidak tersedia.'
    )
  );
}

module.exports = {
  callLLM,
  PROVIDERS,
  getModels,
};
