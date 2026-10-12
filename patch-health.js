// patch-health.js — persist health state ke data/health-state.json
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'src', 'providers', 'index.js');
let src = fs.readFileSync(FILE, 'utf8');

if (src.includes('HEALTH_STATE_PATH')) {
  console.log('SKIP: sudah dipatch sebelumnya');
  process.exit(0);
}

// 1. Tambah fs + path require kalau belum ada
if (!src.includes("const fs = require('fs')")) {
  src = src.replace(
    "require('dotenv').config();",
    "require('dotenv').config();\nconst fs = require('fs');\nconst path = require('path');"
  );
}

// 2. Tambah persistence layer sebelum isModelUnhealthy
const anchor1 = `function isModelUnhealthy(provider, model) {`;
const addition1 = `// === Health state persistence ===
const HEALTH_STATE_PATH = path.join(__dirname, '..', '..', 'data', 'health-state.json');

function loadHealthState() {
  try {
    if (!fs.existsSync(HEALTH_STATE_PATH)) return;
    const data = JSON.parse(fs.readFileSync(HEALTH_STATE_PATH, 'utf-8'));
    const now = Date.now();
    let nModel = 0, nProv = 0;
    for (const [key, val] of Object.entries(data.models || {})) {
      if (val && val.until > now) { modelHealthCache.set(key, val); nModel++; }
    }
    for (const [key, val] of Object.entries(data.providers || {})) {
      if (val > now) { providerCooldown.set(key, val); nProv++; }
    }
    if (data.lastGoodModel && data.lastGoodModel.provider && data.lastGoodModel.model) {
      lastGoodModel = data.lastGoodModel;
    }
    console.log(\`[health] Loaded \${nModel} model + \${nProv} provider cooldowns from disk\`);
  } catch (e) {
    console.warn('[health] load failed:', e.message);
  }
}

let _saveTimer = null;
function saveHealthState() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      const now = Date.now();
      const models = {};
      const providers = {};
      for (const [key, val] of modelHealthCache) {
        if (val && val.until > now) models[key] = val;
      }
      for (const [key, val] of providerCooldown) {
        if (val > now) providers[key] = val;
      }
      fs.mkdirSync(path.dirname(HEALTH_STATE_PATH), { recursive: true });
      fs.writeFileSync(HEALTH_STATE_PATH, JSON.stringify({
        models, providers, lastGoodModel,
        savedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) {
      console.warn('[health] save failed:', e.message);
    }
  }, 500);
}

function isModelUnhealthy(provider, model) {`;

if (!src.includes(anchor1)) throw new Error('anchor1 tidak ditemukan');
src = src.replace(anchor1, addition1);

// 3. Save saat markModelUnhealthy
const anchor2 = `function markModelUnhealthy(provider, model, ms = MODEL_COOLDOWN_MS) {
  modelHealthCache.set(\`\${provider}/\${model}\`, { until: Date.now() + ms });
}`;
const replacement2 = `function markModelUnhealthy(provider, model, ms = MODEL_COOLDOWN_MS) {
  modelHealthCache.set(\`\${provider}/\${model}\`, { until: Date.now() + ms });
  saveHealthState();
}`;
if (src.includes(anchor2)) src = src.replace(anchor2, replacement2);

// 4. Save saat markProviderCooldown
const anchor3 = `function markProviderCooldown(provider, ms = PROVIDER_COOLDOWN_MS) {
  providerCooldown.set(provider, Date.now() + ms);
}`;
const replacement3 = `function markProviderCooldown(provider, ms = PROVIDER_COOLDOWN_MS) {
  providerCooldown.set(provider, Date.now() + ms);
  saveHealthState();
}`;
if (src.includes(anchor3)) src = src.replace(anchor3, replacement3);

// 5. Save saat lastGoodModel di-set — cari assignment
src = src.replace(
  /lastGoodModel = \{ provider, model \};/g,
  "lastGoodModel = { provider, model }; saveHealthState();"
);

// 6. Call loadHealthState() sebelum module.exports
const anchor4 = "module.exports = {";
if (src.includes(anchor4)) {
  src = src.replace(anchor4, "loadHealthState();\n\nmodule.exports = {");
}

fs.writeFileSync(FILE, src, 'utf8');
console.log('✅ PATCH OK: health state akan dipersist ke data/health-state.json');