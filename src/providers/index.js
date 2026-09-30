require('dotenv').config();
const { isRateLimited } = require('../llm-status');
const { scanMessages, formatDetections } = require('../secret-scanner');

const { callGroq } = require('./groq');
const { callGemini } = require('./gemini');
const { callOpenRouter } = require('./openrouter');
const { callMistral } = require('./mistral');
const { callSambaNova } = require('./sambanova');
const { callLLM7 } = require('./llm7');
const { callLlamaCpp } = require('./llamacpp');

// === Model health cache (anti-503 berulang) ===
const modelHealthCache = new Map();
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

const PROVIDERS = {
  llm7: {
    name: 'LLM7.io',
    models: ['default'],
  },
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
    models: ['gemma-4-31B-it'],
  },
  llamacpp: {
    name: 'Local (llama.cpp)',
    models: ['gemma-3-4b-it'],
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
    models: ['mistral-small-latest'],
  },
};

function getModels(provider) {
  return PROVIDERS[provider]?.models || [];
}

function isModelUnavailable(error) {
  const status = error?.response?.status;
  if (status !== 404 && status !== 400 && status !== 402 && status !== 403) return false;
  const msg = String(
    error?.response?.data?.error?.message || error?.message || ''
  ).toLowerCase();
  return (
    msg.includes('unavailable') ||
    msg.includes('not found') ||
    msg.includes('no endpoints') ||
    (msg.includes('model') && msg.includes('free'))
  );
}

async function callLLM(messages, config, options = {}) {
  // === Secret Scanner ===
  const scan = scanMessages(messages);
  if (scan.detections.length > 0) {
    console.log(
      '[privacy] Secret detected & redacted:',
      formatDetections(scan.detections)
    );
    messages = scan.messages;
  }

  let primaryProvider = (config.provider || 'gemini').toLowerCase();

  if (primaryProvider === 'llamacpp' && options.json === true) {
    console.log('[llm] Agent loop detected → forcing cloud provider (llamacpp too slow for tools)');
    primaryProvider = 'gemini';
  }

  const providerOrder = [
    primaryProvider,
    ...Object.keys(PROVIDERS).filter((provider) => provider !== primaryProvider),
  ];

  const available = [];
  const skipped = [];

  for (const provider of providerOrder) {
    const models = getModels(provider);
    if (!models.length) continue;

    let providerModels = models;
    if (provider === primaryProvider && models.includes(config.model)) {
      providerModels = [config.model, ...models.filter((m) => m !== config.model)];
    }

    for (const model of providerModels) {
      if (isRateLimited(provider, model)) {
        skipped.push({ provider, model });
        console.log(`[llm] Skipping ${provider}/${model} (rate-limited)`);
      } else if (isModelUnhealthy(provider, model)) {
        skipped.push({ provider, model });
        console.log(`[llm] Skipping ${provider}/${model} (unhealthy cooldown)`);
      } else {
        available.push({ provider, model });
      }
    }
  }

  if (available.length === 0 && skipped.length > 0) {
    console.log('[llm] Semua provider rate-limited — mencoba sebagai last resort...');
  }

  const attemptOrder = [...available, ...skipped];
  let lastError = null;

  for (const { provider, model } of attemptOrder) {
    console.log(`[llm] Trying provider: ${provider} | model: ${model}`);

    try {
      if (provider === 'llm7') return await callLLM7(messages, model, options);
      if (provider === 'sambanova') return await callSambaNova(messages, model, options);
      if (provider === 'groq') return await callGroq(messages, model, options);
      if (provider === 'llamacpp') return await callLlamaCpp(messages, model, options);
      if (provider === 'gemini') return await callGemini(messages, model, options);
      if (provider === 'openrouter') return await callOpenRouter(messages, model, options);
      if (provider === 'mistral') return await callMistral(messages, model, options);

      throw new Error(`Provider ${provider} belum memiliki adapter.`);
    } catch (error) {
      lastError = error;

      const isQuota =
        error.quota === true ||
        error.response?.status === 429 ||
        /quota|rate limit|limit|429/i.test(error.message || '');

      if (isQuota) {
        console.log(`[llm] ${provider}/${model} limit → fallback ke provider berikutnya...`);
        continue;
      }

      if (isModelUnavailable(error)) {
        console.log(`[llm] ${provider}/${model} tidak tersedia → coba model lain...`);
        continue;
      }

      const status = error.response?.status;
      const msg = String(error.message || '').toLowerCase();
      const isTransient =
        status === 503 ||
        status === 502 ||
        status === 504 ||
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

      console.log(`[llm] ${provider}/${model} gagal: ${error.message}`);
      continue;
    }
  }

  throw lastError || new Error('Semua provider AI sedang tidak tersedia.');
}

module.exports = {
  callLLM,
  PROVIDERS,
  getModels,
};
