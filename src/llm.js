require("dotenv").config();
const axios = require('axios');
const { markSuccess, markRateLimited, markError, recordUsage } = require('./llm-status');
const { scanMessages, formatDetections } = require('./secret-scanner');
const { isRateLimited } = require('./llm-status');

// === Model health cache (anti-503 berulang) ===
const modelHealthCache = new Map(); // key: "provider/model" → { until: timestamp }
const MODEL_COOLDOWN_MS = 60 * 1000;

function isModelUnhealthy(provider, model) {
  const key = `${provider}/${model}`;
  const entry = modelHealthCache.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) {
    modelHealthCache.delete(key);
    return false;
  }
  return true;
}

function markModelUnhealthy(provider, model) {
  const key = `${provider}/${model}`;
  modelHealthCache.set(key, { until: Date.now() + MODEL_COOLDOWN_MS });
}
// === end Model health cache ===

const PROVIDERS = {
  groq: {
    name: 'Groq',
    models: [
      'openai/gpt-oss-120b',
      'qwen/qwen3.8-27b',
      'openai/gpt-oss-20b',
    ],
  },

  sambanova: {
    name: 'SambaNova',
    models: [
      'Meta-Llama-3.3-70B-Instruct',
      'gpt-oss-120b',
      'DeepSeek-V3.2',
      'gemma-4-31B-it',
    ],
  },

  llamacpp: {
    name: 'Local (llama.cpp)',
    models: [
      'gemma-3-4b-it',
    ],
  },

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
      // Verified free 2026-09-21, support JSON + tool calling
      'qwen/qwen3.8-27b:free',
      'z-ai/glm-5.2:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-4-31b-it:free',
      'google/gemma-4-26b-a4b-it:free',
      'cohere/north-mini-code:free',
      'poolside/laguna-s-2.1:free',
      'poolside/laguna-xs-2.1:free',
      'thinkingmachines/inkling:free',
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

const SAMBANOVA_URL =
  process.env.SAMBANOVA_URL ||
  'https://api.sambanova.ai/v1';

const GROQ_URL =
  process.env.GROQ_URL ||
  'https://api.groq.com/openai/v1';

const LLAMACPP_URL =
  process.env.LLAMACPP_URL ||
  'http://127.0.0.1:8080/v1';

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
    groq: process.env.GROQ_API_KEY,
    sambanova: process.env.SAMBANOVA_API_KEY,
    llamacpp: process.env.LLAMACPP_API_KEY || 'local',
    openrouter: process.env.OPENROUTER_API_KEY,
    mistral: process.env.MISTRAL_API_KEY,
  };

  return keys[provider];
}


function isModelUnavailable(error) {
  const status = error?.response?.status;
  if (status !== 404 && status !== 400) return false;
  const msg = String(
    error?.response?.data?.error?.message ||
    error?.message ||
    ''
  ).toLowerCase();
  return (
    msg.includes('unavailable') ||
    msg.includes('not found') ||
    msg.includes('no endpoints') ||
    msg.includes('model') && msg.includes('free')
  );
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

  const generationConfig = {
    maxOutputTokens: 2048,
    temperature: 0.7,
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


async function callGemini(messages, model, options = {}) {
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
        buildGeminiRequest(messages, options),
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
      }, keyNumber);

      markSuccess("gemini", model, {
        lastError: null,
      }, keyNumber);

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

          let retryAfter = null;
          if (retryInfo?.retryDelay) {
            const raw = String(retryInfo.retryDelay).trim();
            const val = Number.parseFloat(raw);
            if (!Number.isNaN(val)) {
              if (raw.endsWith('ms')) retryAfter = val / 1000;
              else retryAfter = val; // assume seconds
            }
          }

          // Fallback: parse dari pesan "Please retry in 59.5s" / "107ms"
          if (retryAfter === null) {
            const fallback = String(data?.error?.message || '')
              .match(/retry in ([\d.]+)(ms|s)\b/i);
            if (fallback) {
              const v = Number.parseFloat(fallback[1]);
              retryAfter = fallback[2].toLowerCase() === 'ms' ? v / 1000 : v;
            }
          }

          const rawMessage =
            data?.error?.message || "Gemini rate limit/quota";
          const message = rawMessage
            .replace(/\s+/g, ' ')
            .slice(0, 200);

          markRateLimited("gemini", model, {
            limit,
            remaining: 0,
            used: limit,
            retryAfter,
            lastError: message,
          }, keyNumber);

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

function sanitizeForLlamaCpp(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [{ role: 'user', content: 'Halo' }];
  }

  const out = [];

  // 1. System messages — gabung jadi satu di awal
  const systems = messages.filter(m => m.role === 'system' && m.content);
  if (systems.length > 0) {
    out.push({
      role: 'system',
      content: systems.map(s => String(s.content)).join('\n\n'),
    });
  }

  // 2. Non-system — alternating user/assistant
  const rest = messages.filter(m => m.role !== 'system' && m.content);

  for (const msg of rest) {
    const content = String(msg.content);
    if (!content.trim()) continue;

    const last = out[out.length - 1];

    // Gabung kalau role sama
    if (last && last.role === msg.role) {
      last.content += '\n\n' + content;
      continue;
    }

    // Skip assistant yang muncul tanpa user sebelumnya
    const lastNonSystem = out.filter(m => m.role !== 'system').pop();
    if (msg.role === 'assistant' && !lastNonSystem) continue;

    out.push({ role: msg.role, content });
  }

  // 3. Buang assistant di akhir
  while (out.length > 0 && out[out.length - 1].role === 'assistant') {
    out.pop();
  }

  // 4. Pastikan ada minimal 1 user message
  if (!out.some(m => m.role === 'user')) {
    out.push({ role: 'user', content: 'Halo' });
  }

  return out;
}

async function callSambaNova(messages, model, options = {}) {
  const apiKey = getApiKey('sambanova');

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
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 60000,
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content?.trim();

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
      const err = new Error(`SambaNova rate limit: ${error.response?.data?.error?.message || 'unknown'}`);
      err.quota = true;
      err.retryAfter = retryAfter ? Number(retryAfter) : null;
      throw err;
    }
    throw error;
  }
}

async function callGroq(messages, model, options = {}) {
  const apiKey = getApiKey('groq');

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
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 60000,
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content?.trim();

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
      const err = new Error(`Groq rate limit: ${error.response?.data?.error?.message || 'unknown'}`);
      err.quota = true;
      err.retryAfter = retryAfter ? Number(retryAfter) : null;
      throw err;
    }
    throw error;
  }
}

async function callLlamaCpp(messages, model, options = {}) {
  const apiKey = getApiKey('llamacpp');

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
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && apiKey !== 'local'
            ? { Authorization: `Bearer ${apiKey}` }
            : {}),
        },
        timeout: 180000, // 3 menit
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('llama.cpp tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('llamacpp', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('llamacpp', model, {
      lastError: null,
    });

    return text;
  } catch (error) {
    if (error.response) {
      console.error('[llamacpp] 400 body:', JSON.stringify(error.response.data).slice(0, 500));
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error(`llama.cpp tidak bisa dijangkau: ${error.message}`);
    }
    throw error;
  }
}

async function callOpenRouter(messages, model, options = {}) {
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
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
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

async function callMistral(messages, model, options = {}) {
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
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
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

async function callLLM(messages, config, options = {}) {
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

  // === Hybrid routing: local untuk chat, cloud untuk agent ===
  let primaryProvider =
    (config.provider || 'gemini').toLowerCase();

  if (primaryProvider === 'llamacpp' && options.json === true) {
    console.log('[llm] Agent loop detected → forcing cloud provider (llamacpp too slow for tools)');
    primaryProvider = 'gemini';
  }
  // === end Hybrid routing ===

  const providerOrder = [
    primaryProvider,
    ...Object.keys(PROVIDERS).filter(
      (provider) => provider !== primaryProvider
    ),
  ];

  // === Rate-limit aware routing (multi-model per provider) ===
  const available = [];
  const skipped = [];

  for (const provider of providerOrder) {
    const models = getModels(provider);
    if (!models.length) continue;

    // Prioritaskan config.model kalau ada di primary provider
    let providerModels = models;
    if (provider === primaryProvider && models.includes(config.model)) {
      providerModels = [config.model, ...models.filter((m) => m !== config.model)];
    }

    for (const model of providerModels) {
      if (isRateLimited(provider, model)) {
        skipped.push({ provider, model });
        console.log(
          `[llm] Skipping ${provider}/${model} (rate-limited)`
        );
      } else if (isModelUnhealthy(provider, model)) {
        skipped.push({ provider, model });
        console.log(
          `[llm] Skipping ${provider}/${model} (unhealthy cooldown)`
        );
      } else {
        available.push({ provider, model });
      }
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
      if (provider === 'sambanova') {
        return await callSambaNova(messages, model, options);
      }

      if (provider === 'groq') {
        return await callGroq(messages, model, options);
      }

      if (provider === 'llamacpp') {
        return await callLlamaCpp(messages, model, options);
      }

      if (provider === 'gemini') {
        return await callGemini(messages, model, options);
      }

      if (provider === 'openrouter') {
        return await callOpenRouter(messages, model, options);
      }

      if (provider === 'mistral') {
        return await callMistral(messages, model, options);
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

      if (isModelUnavailable(error)) {
        console.log(
          `[llm] ${provider}/${model} tidak tersedia → coba model lain...`
        );
        continue;
      }

      // 503 / 502 / 504 / timeout → tandai unhealthy sementara
      const status = error.response?.status;
      const msg = String(error.message || '').toLowerCase();
      const isTransient =
        status === 503 || status === 502 || status === 504 ||
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        msg.includes('timeout') ||
        msg.includes('econnaborted') ||
        msg.includes('etimedout') ||
        msg.includes('service is currently unavailable') ||
        msg.includes('currently experiencing high demand');

      if (isTransient) {
        markModelUnhealthy(provider, model);
        console.log(
          `[llm] ${provider}/${model} unhealthy (${status || error.code || 'transient'}) → cooldown 60s`
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
