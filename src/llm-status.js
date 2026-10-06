const fs = require('fs');
const path = require('path');

const providers = new Map();

const STATE_FILE = path.join(__dirname, '..', 'data', 'llm-status.json');
const DEFAULT_RATE_LIMIT_MS = 60 * 1000;
const MAX_RATE_LIMIT_MS = 15 * 60 * 1000;

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
      rateLimitCount: 0,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      lastChecked: null,
    });
  }
  return providers.get(key);
}

// FIX D6: Debounce state persistence to eliminate event-loop blocking on every token update
let persistTimer = null;

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      const obj = {};
      for (const [key, entry] of providers) {
        obj[key] = entry;
      }
      await fs.promises.mkdir(path.dirname(STATE_FILE), { recursive: true });
      const tmpFile = `${STATE_FILE}.tmp`;
      await fs.promises.writeFile(tmpFile, JSON.stringify(obj, null, 2), 'utf-8');
      await fs.promises.rename(tmpFile, STATE_FILE);
    } catch (e) {
      console.warn('[llm-status] persist failed:', e.message);
    }
  }, 1000);
  // Do not block process exit
  if (persistTimer.unref) persistTimer.unref();
}

function persistState() {
  try {
    const obj = {};
    for (const [key, entry] of providers) {
      obj[key] = entry;
    }
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmpFile = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmpFile, STATE_FILE);
  } catch (e) {
    console.warn('[llm-status] persist failed:', e.message);
  }
}


function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    for (const [key, entry] of Object.entries(parsed)) {
      providers.set(key, entry);
    }
    if (providers.size > 0) {
      console.log(`[llm-status] Loaded ${providers.size} entries from state file`);
    }
  } catch (e) {
    console.warn('[llm-status] load failed:', e.message);
  }
}

loadState();

function updateProvider(provider, model, data = {}, keyId = null) {
  const entry = ensureProvider(provider, model, keyId);
  Object.assign(entry, data, { lastChecked: now() });
  schedulePersist();
  return { ...entry };
}

function markSuccess(provider, model, data = {}, keyId = null) {
  const entry = ensureProvider(provider, model, keyId);
  entry.rateLimitCount = 0;
  return updateProvider(provider, model, {
    status: "available",
    lastError: null,
    retryAfter: null,
    resetAt: null,
    ...data,
  }, keyId);
}

function markRateLimited(provider, model, data = {}, keyId = null) {
  const entry = ensureProvider(provider, model, keyId);
  const count = (Number(entry.rateLimitCount) || 0) + 1;
  return updateProvider(provider, model, {
    status: "rate_limited",
    rateLimitCount: count,
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
  schedulePersist();

  return { ...entry, usage: { ...entry.usage } };
}

function markError(provider, model, error, keyId = null) {
  return updateProvider(provider, model, {
    status: "error",
    lastError: error instanceof Error ? error.message : String(error),
  }, keyId);
}

function getScaledCooldownMs(count) {
  const n = Math.max(1, Number(count) || 1);
  const scaled = DEFAULT_RATE_LIMIT_MS * Math.pow(2, n - 1);
  return Math.min(scaled, MAX_RATE_LIMIT_MS);
}

function checkEntryRateLimited(entry) {
  if (entry.status !== 'rate_limited') return false;

  const nowMs = Date.now();
  const lastCheckMs = entry.lastChecked
    ? new Date(entry.lastChecked).getTime()
    : nowMs;

  // 1. retryAfter (detik) dari provider response
  if (entry.retryAfter != null && !Number.isNaN(Number(entry.retryAfter))) {
    const retryAt = lastCheckMs + Number(entry.retryAfter) * 1000;
    if (nowMs < retryAt) return true;
    entry.status = 'unknown';
    entry.retryAfter = null;
    entry.lastChecked = now();
    return false;
  }

  // 2. resetAt (ISO) dari header
  if (entry.resetAt) {
    const resetMs = new Date(entry.resetAt).getTime();
    if (!Number.isNaN(resetMs) && nowMs < resetMs) return true;
    entry.status = 'unknown';
    entry.resetAt = null;
    entry.lastChecked = now();
    return false;
  }

  // 3. Exponential backoff based on failure count
  const cooldown = getScaledCooldownMs(entry.rateLimitCount);
  const retryAt = lastCheckMs + cooldown;
  if (nowMs < retryAt) return true;

  entry.status = 'unknown';
  entry.lastChecked = now();
  return false;
}

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
  // FIX Q19: Deep clone usage object so callers cannot mutate internal Map state
  return Array.from(providers.values()).map((entry) => ({
    ...entry,
    usage: entry.usage ? { ...entry.usage } : { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  }));
}


function clearProviderStatus() {
  providers.clear();
  persistState();
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
