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
  clearProviderStatus,
};
