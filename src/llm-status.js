const providers = new Map();

function now() {
  return new Date().toISOString();
}

function makeKey(provider, model, keyId = null) {
  return keyId != null
    ? `${provider}#${keyId}/${model}`
    : `${provider}/${model}`;
}

function ensureProvider(provider, model, keyId = null) {
  const key = makeKey(provider, model, keyId);
  if (!providers.has(key)) {
    providers.set(key, {
      provider,
      model,
      keyId,
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

function updateProvider(provider, model, data = {}, keyId = null) {
  const entry = ensureProvider(provider, model, keyId);
  Object.assign(entry, data, { lastChecked: now() });
  return { ...entry };
}

function markSuccess(provider, model, data = {}, keyId = null) {
  return updateProvider(provider, model, {
    status: "available",
    lastError: null,
    retryAfter: null,
    ...data,
  }, keyId);
}

function markRateLimited(provider, model, data = {}, keyId = null) {
  return updateProvider(provider, model, {
    status: "rate_limited",
    ...data,
  }, keyId);
}

function recordUsage(provider, model, usage = {}, keyId = null) {
  const entry = ensureProvider(provider, model, keyId);
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

function markError(provider, model, error, keyId = null) {
  return updateProvider(provider, model, {
    status: "error",
    lastError: error instanceof Error ? error.message : String(error),
  }, keyId);
}

const DEFAULT_RATE_LIMIT_MS = 60 * 1000;

/**
 * Return true kalau entry masih rate-limited (window belum lewat).
 * Auto-reset kalau window sudah lewat.
 */
function checkEntryRateLimited(entry) {
  if (entry.status !== 'rate_limited') return false;

  const nowMs = Date.now();
  const lastCheckMs = entry.lastChecked
    ? new Date(entry.lastChecked).getTime()
    : nowMs;

  if (entry.retryAfter != null && !Number.isNaN(Number(entry.retryAfter))) {
    const retryAt = lastCheckMs + Number(entry.retryAfter) * 1000;
    if (nowMs < retryAt) return true;
    entry.status = 'unknown';
    entry.retryAfter = null;
    entry.lastChecked = now();
    return false;
  }

  if (entry.resetAt) {
    const resetMs = new Date(entry.resetAt).getTime();
    if (!Number.isNaN(resetMs) && nowMs < resetMs) return true;
    entry.status = 'unknown';
    entry.resetAt = null;
    entry.lastChecked = now();
    return false;
  }

  const defaultRetryAt = lastCheckMs + DEFAULT_RATE_LIMIT_MS;
  if (nowMs < defaultRetryAt) return true;

  entry.status = 'unknown';
  entry.lastChecked = now();
  return false;
}

/**
 * Provider dianggap rate-limited HANYA kalau SEMUA key-nya rate-limited.
 * Kalau ada minimal 1 key available → false.
 */
function isRateLimited(provider, model) {
  const matching = [...providers.values()].filter(
    (e) => e.provider === provider && e.model === model
  );

  if (matching.length === 0) return false;

  const perKey = matching.filter((e) => e.keyId != null);
  if (perKey.length > 0) {
    return perKey.every((e) => checkEntryRateLimited(e));
  }

  const base = matching.find((e) => e.keyId == null);
  return base ? checkEntryRateLimited(base) : false;
}

function getProviderStatus(provider, model, keyId = null) {
  return providers.get(makeKey(provider, model, keyId)) || null;
}

function getAllProviderStatus() {
  return Array.from(providers.values()).map((entry) => ({ ...entry }));
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
