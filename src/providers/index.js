require('dotenv').config();
const { isRateLimited, markRateLimited } = require('../llm-status');
const { scanMessages, formatDetections } = require('../secret-scanner');

const { callGroq } = require('./groq');
const { callGemini } = require('./gemini');
const { callOpenRouter } = require('./openrouter');
const { callMistral } = require('./mistral');
const { callSambaNova } = require('./sambanova');
const { callLLM7 } = require('./llm7');
const { callLlamaCpp } = require('./llamacpp');

const modelHealthCache = new Map();
const MODEL_COOLDOWN_MS = 10 * 60 * 1000; // 404 / unavailable
const TRANSIENT_COOLDOWN_MS = 5 * 60 * 1000; // 503 high demand
const providerCooldown = new Map();
const PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;

/** Model terakhir yang sukses — diprioritaskan di call berikutnya */
let lastGoodModel = null; // { provider, model }

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

function markModelUnhealthy(provider, model, ms = MODEL_COOLDOWN_MS) {
  modelHealthCache.set(`${provider}/${model}`, { until: Date.now() + ms });
}

function isProviderOnCooldown(provider) {
  const until = providerCooldown.get(provider);
  if (!until) return false;
  if (Date.now() > until) {
    providerCooldown.delete(provider);
    return false;
  }
  return true;
}

function markProviderCooldown(provider, ms = PROVIDER_COOLDOWN_MS) {
  providerCooldown.set(provider, Date.now() + ms);
}

function extractStatusCode(error) {
  if (error?.statusCode) return Number(error.statusCode);
  if (error?.response?.status) return Number(error.response.status);
  const msg = String(error?.message || '');
  const m = msg.match(/\((\d{3})\)/);
  if (m) return Number(m[1]);
  const m2 = msg.match(/\b(429|402|503|502|504|401|403|404)\b/);
  if (m2) return Number(m2[1]);
  return null;
}

function isTransientError(error) {
  const status = extractStatusCode(error);
  const msg = String(error?.message || '').toLowerCase();
  return (
    status === 503 ||
    status === 502 ||
    status === 504 ||
    error?.code === 'ECONNABORTED' ||
    error?.code === 'ETIMEDOUT' ||
    msg.includes('timeout') ||
    msg.includes('high demand') ||
    msg.includes('currently experiencing') ||
    msg.includes('service is currently unavailable') ||
    msg.includes('temporarily')
  );
}


/**
 * Hanya provider yang punya API key di .env yang boleh dipakai.
 * LLM7 TIDAK otomatis aktif — harus set LLM7_API_KEY di .env.
 */
function hasProviderKey(provider) {
  const nonEmpty = (v) => !!(v && String(v).trim());

  switch (provider) {
    case 'groq':
      return nonEmpty(process.env.GROQ_API_KEY);
    case 'gemini':
      return (
        nonEmpty(process.env.GEMINI_API_KEY_1) ||
        nonEmpty(process.env.GEMINI_API_KEY_2) ||
        nonEmpty(process.env.GEMINI_API_KEY_3) ||
        nonEmpty(process.env.GEMINI_API_KEY)
      );
    case 'openrouter':
      return nonEmpty(process.env.OPENROUTER_API_KEY);
    case 'mistral':
      return nonEmpty(process.env.MISTRAL_API_KEY);
    case 'sambanova':
      return nonEmpty(process.env.SAMBANOVA_API_KEY);
    case 'llm7':
      // Harus eksplisit di .env (boleh nilai "unused" jika memang mau pakai LLM7)
      return nonEmpty(process.env.LLM7_API_KEY);
    case 'llamacpp':
      return nonEmpty(process.env.LLAMACPP_URL);
    default:
      return false;
  }
}

function normalizeModelName(model) {
  if (!model || typeof model !== 'string') return model;
  const s = model.trim();
  const slash = s.indexOf('/');
  if (slash > 0 && !s.includes(':')) {
    const maybeProvider = s.slice(0, slash).toLowerCase();
    if (['gemini', 'groq', 'sambanova', 'mistral', 'llm7', 'llamacpp'].includes(maybeProvider)) {
      return s.slice(slash + 1);
    }
  }
  return s;
}

const PROVIDERS = {
  groq: {
    name: 'Groq',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'gemma2-9b-it',
      'mixtral-8x7b-32768',
    ],
  },
  gemini: {
    name: 'Google Gemini',
    models: [
      'gemini-3.8-flash',
      'gemini-3.5-flash',
      'gemini-3.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
    ],
  },
  openrouter: {
    name: 'OpenRouter',
    models: [
      'google/gemma-2-9b-it:free',
      'meta-llama/llama-3.2-3b-instruct:free',
      'microsoft/phi-3-mini-128k-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
      'mistralai/mistral-7b-instruct:free',
    ],
  },
  mistral: {
    name: 'Mistral AI',
    models: ['mistral-small-latest', 'open-mistral-7b'],
  },
  sambanova: {
    name: 'SambaNova',
    models: ['Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'],
  },
  llm7: {
    name: 'LLM7.io',
    models: ['default'],
  },
  llamacpp: {
    name: 'Local (llama.cpp)',
    models: ['local-model'],
  },
};

function getModels(provider) {
  return PROVIDERS[provider]?.models || [];
}

function isPaymentOrQuotaError(error) {
  const status = error?.response?.status;
  if (error?.quota === true) return true;
  if (status === 429 || status === 402) return true;
  const msg = String(
    error?.response?.data?.error?.message || error?.message || ''
  ).toLowerCase();
  return (
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('rate_limit') ||
    msg.includes('payment required') ||
    msg.includes('insufficient') ||
    msg.includes('billing') ||
    msg.includes('credit')
  );
}

function isModelUnavailable(error) {
  const status = error?.response?.status;
  const msg = String(
    error?.response?.data?.error?.message || error?.message || ''
  ).toLowerCase();
  if (status === 404) return true;
  if (msg.includes('no longer available') || msg.includes('is not found')) return true;
  if (status !== 400 && status !== 403) return false;
  return (
    msg.includes('unavailable') ||
    msg.includes('not found') ||
    msg.includes('no endpoints')
  );
}

function extractSuggestedModel(error) {
  const msg = String(
    error?.response?.data?.error?.message || error?.message || ''
  );
  const m = msg.match(/models\/([a-z0-9._-]+)/i);
  if (m && m[1]) return m[1];
  return null;
}

async function callLLM(messages, config, options = {}) {
  const scan = scanMessages(messages);
  if (scan.detections.length > 0) {
    console.log(
      '[privacy] Secret detected & redacted:',
      formatDetections(scan.detections)
    );
    messages = scan.messages;
  }

  let primaryProvider = (config.provider || 'gemini').toLowerCase();
  let preferredModel = normalizeModelName(config.model);

  if (primaryProvider === 'llamacpp' && options.json === true) {
    console.log('[llm] Agent loop → cloud provider');
    primaryProvider = hasProviderKey('groq')
      ? 'groq'
      : hasProviderKey('gemini')
        ? 'gemini'
        : Object.keys(PROVIDERS).find((p) => hasProviderKey(p)) || 'gemini';
  }

  // HANYA provider yang ada key di .env
  const allWithKeys = Object.keys(PROVIDERS).filter(
    (p) => p !== primaryProvider && hasProviderKey(p)
  );
  const providerOrder = hasProviderKey(primaryProvider)
    ? [primaryProvider, ...allWithKeys]
    : allWithKeys;

  if (providerOrder.length === 0) {
    throw new Error(
      'Tidak ada provider dengan API key di .env. Isi minimal 1 key (GEMINI_API_KEY_1, GROQ_API_KEY, dll).'
    );
  }

  console.log(
    `[llm] Provider aktif (ada key): ${providerOrder.join(', ')}`
  );

  const available = [];
  const skipped = [];
  const deadProviders = new Set();

  for (const provider of providerOrder) {
    if (isProviderOnCooldown(provider)) {
      console.log(`[llm] Skipping provider ${provider} (cooldown)`);
      continue;
    }

    const models = getModels(provider);
    if (!models.length) continue;

    let providerModels = [...models];
    // Prefer model yang baru sukses (hindari retry model 503 tiap step)
    if (
      lastGoodModel &&
      lastGoodModel.provider === provider &&
      !isModelUnhealthy(provider, lastGoodModel.model)
    ) {
      const g = lastGoodModel.model;
      providerModels = [g, ...models.filter((m) => m !== g)];
    }
    if (provider === primaryProvider && preferredModel) {
      if (!isModelUnhealthy(provider, preferredModel)) {
        if (models.includes(preferredModel) || preferredModel === lastGoodModel?.model) {
          providerModels = [
            preferredModel,
            ...providerModels.filter((m) => m !== preferredModel),
          ];
        } else if (!isModelUnhealthy(provider, preferredModel)) {
          // coba preferred sekali, tapi lastGood tetap di depan jika beda
          if (lastGoodModel?.provider === provider && lastGoodModel.model !== preferredModel) {
            providerModels = [
              lastGoodModel.model,
              preferredModel,
              ...models.filter((m) => m !== preferredModel && m !== lastGoodModel.model),
            ];
          } else {
            providerModels = [preferredModel, ...models.filter((m) => m !== preferredModel)];
          }
        }
      } else {
        // preferred sedang cooldown → skip, pakai lastGood / sisa list
        console.log(
          `[llm] Skip preferred ${provider}/${preferredModel} (cooldown)`
        );
      }
    }

    for (const model of providerModels) {
      if (isRateLimited(provider, model) || isModelUnhealthy(provider, model)) {
        skipped.push({ provider, model });
      } else {
        available.push({ provider, model });
      }
    }
  }

  const attemptOrder = [...available, ...skipped];
  let lastError = null;
  const triedSuggestions = new Set();

  for (const { provider, model } of attemptOrder) {
    if (deadProviders.has(provider) || isProviderOnCooldown(provider)) continue;
    if (isModelUnhealthy(provider, model)) {
      console.log(`[llm] Skipping ${provider}/${model} (masih cooldown)`);
      continue;
    }

    console.log(`[llm] Trying provider: ${provider} | model: ${model}`);

    try {
      let text;
      if (provider === 'llm7') text = await callLLM7(messages, model, options);
      else if (provider === 'sambanova') text = await callSambaNova(messages, model, options);
      else if (provider === 'groq') text = await callGroq(messages, model, options);
      else if (provider === 'llamacpp') text = await callLlamaCpp(messages, model, options);
      else if (provider === 'gemini') text = await callGemini(messages, model, options);
      else if (provider === 'openrouter') text = await callOpenRouter(messages, model, options);
      else if (provider === 'mistral') text = await callMistral(messages, model, options);
      else throw new Error(`Provider ${provider} belum memiliki adapter.`);

      lastGoodModel = { provider, model };
      console.log(`[llm] ✓ pakai ${provider}/${model} (sticky untuk request berikutnya)`);
      return text;
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const msg = String(error.message || '').toLowerCase();

      if (isPaymentOrQuotaError(error)) {
        try {
          markRateLimited(provider, model, { lastError: error.message });
        } catch (_) {}
        markProviderCooldown(provider);
        deadProviders.add(provider);
        console.log(
          `[llm] ${provider}/${model} quota/402 → skip provider, pindah AI lain...`
        );
        continue;
      }

      if (isModelUnavailable(error)) {
        markModelUnhealthy(provider, model);
        console.log(
          `[llm] ${provider}/${model} tidak tersedia → cooldown, coba model lain...`
        );
        const suggested = extractSuggestedModel(error);
        if (
          suggested &&
          provider === 'gemini' &&
          !triedSuggestions.has(suggested) &&
          suggested !== model
        ) {
          triedSuggestions.add(suggested);
          console.log(`[llm] Mencoba model saran API: ${suggested}`);
          try {
            return await callGemini(messages, suggested, options);
          } catch (e2) {
            lastError = e2;
            markModelUnhealthy(provider, suggested);
          }
        }
        continue;
      }

      if (isTransientError(error)) {
        const code = extractStatusCode(error) || status || 'transient';
        markModelUnhealthy(provider, model, TRANSIENT_COOLDOWN_MS);
        // Jangan pakai model ini sebagai preferred lagi di step agent berikutnya
        if (lastGoodModel && lastGoodModel.provider === provider && lastGoodModel.model === model) {
          lastGoodModel = null;
        }
        console.log(
          `[llm] ${provider}/${model} high-demand/503 (${code}) → skip ${TRANSIENT_COOLDOWN_MS / 1000}s, coba model lain...`
        );
        continue;
      }

      if (
        status === 401 ||
        msg.includes('api key') ||
        msg.includes('tidak ditemukan') ||
        msg.includes('unauthorized')
      ) {
        deadProviders.add(provider);
        console.log(`[llm] ${provider} auth error → skip provider`);
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
  hasProviderKey,
  normalizeModelName,
};
