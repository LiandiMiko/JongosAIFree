const providers = new Map();

function now() {
  return new Date().toISOString();
}

function ensureProvider(provider, model) {
  const key = `${provider}/${model}`;
  if (!providers.has(key)) {
    providers.set(key, {
      provider,
      model,
      status: "unknown",
      limit: null,
      remaining: null,
      used: null,
      resetAt: null,
      retryAfter: null,
      lastError: null,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      lastChecked: null,
    });
  }
  return providers.get(key);
}

function updateProvider(provider, model, data = {}) {
  const entry = ensureProvider(provider, model);
  Object.assign(entry, data, { lastChecked: now() });
  return { ...entry };
}

function markSuccess(provider, model, data = {}) {
  return updateProvider(provider, model, {
    status: "available",
    lastError: null,
    retryAfter: null,
    ...data,
  });
}

function markRateLimited(provider, model, data = {}) {
  return updateProvider(provider, model, {
    status: "rate_limited",
    ...data,
  });
}

function recordUsage(provider, model, usage = {}) {
  const entry = ensureProvider(provider, model);
  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const totalTokens = Number(usage.totalTokens || inputTokens + outputTokens);

  entry.usage.requests += 1;
  entry.usage.inputTokens += inputTokens;
  entry.usage.outputTokens += outputTokens;
  entry.usage.totalTokens += totalTokens;
  entry.lastChecked = now();

  return { ...entry, usage: { ...entry.usage } };
}

const DEFAULT_RATE_LIMIT_MS = 60 * 1000;

/**
 * Cek apakah provider/model sedang rate-limited.
 * Kalau retryAfter atau resetAt sudah lewat → auto-reset status.
 */
function isRateLimited(provider, model) {
  const entry = ensureProvider(provider, model);

  if (entry.status !== 'rate_limited') {
    return false;
  }

  const nowMs = Date.now();
  const lastCheckMs = entry.lastChecked
    ? new Date(entry.lastChecked).getTime()
    : nowMs;

  // 1. retryAfter (dalam detik) — dari Gemini RetryInfo
  if (entry.retryAfter != null && !Number.isNaN(Number(entry.retryAfter))) {
    const retryAt = lastCheckMs + Number(entry.retryAfter) * 1000;
    if (nowMs < retryAt) {
      return true;
    }
    // expired → auto-reset
    entry.status = 'unknown';
    entry.retryAfter = null;
    entry.lastChecked = new Date().toISOString();
    return false;
  }

  // 2. resetAt (ISO string) — dari OpenRouter / Mistral headers
  if (entry.resetAt) {
    const resetMs = new Date(entry.resetAt).getTime();
    if (!Number.isNaN(resetMs) && nowMs < resetMs) {
      return true;
    }
    entry.status = 'unknown';
    entry.resetAt = null;
    entry.lastChecked = new Date().toISOString();
    return false;
  }

  // 3. Nggak ada timing info → pakai default window
  const defaultRetryAt = lastCheckMs + DEFAULT_RATE_LIMIT_MS;
  if (nowMs < defaultRetryAt) {
    return true;
  }

  entry.status = 'unknown';
  entry.lastChecked = new Date().toISOString();
  return false;
}

function markError(provider, model, error) {
  return updateProvider(provider, model, {
    status: "error",
    lastError: error instanceof Error ? error.message : String(error),
  });
}

function getProviderStatus(provider, model) {
  return providers.get(`${provider}/${model}`) || null;
}

function getAllProviderStatus() {
  return Array.from(providers.values()).map(entry => ({ ...entry }));
}

function clearProviderStatus() {
  providers.clear();
}

module.exports = {
  updateProvider,
  markSuccess,
  markRateLimited,
  markError,
  getProviderStatus,
  getAllProviderStatus,
  recordUsage,
  isRateLimited,
  clearProviderStatus,
};
