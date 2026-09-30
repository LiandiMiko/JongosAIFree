// Android Bionic patch — MUST be first before any other require
const os = require('os');
const _orig = os.networkInterfaces.bind(os);
os.networkInterfaces = () => {
  try {
    return _orig();
  } catch {
    return {};
  }
};

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadSkills } = require('./src/skills');
const { startTelegram } = require('./src/telegram');
const { startWebUI } = require('./src/webui');

const CONFIG_PATH = path.join(__dirname, 'config.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('No config.json found. Run "npm run setup" first.');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error('Failed to parse config.json:', err.message);
  process.exit(1);
}

// Detect configured providers from env
const hasGeminiKey =
  process.env.GEMINI_API_KEY_1 ||
  process.env.GEMINI_API_KEY_2 ||
  process.env.GEMINI_API_KEY_3 ||
  process.env.GEMINI_API_KEY;
const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
const hasMistralKey = !!process.env.MISTRAL_API_KEY;
const hasLlamaCpp = !!process.env.LLAMACPP_URL;
const hasGroq = !!process.env.GROQ_API_KEY;
const hasSambaNova = !!process.env.SAMBANOVA_API_KEY;
const hasLLM7 = !!process.env.LLM7_API_KEY;

const configuredProvider = (config.provider || 'groq').toLowerCase();
const providerKeys = {
  gemini: !!hasGeminiKey,
  openrouter: hasOpenRouterKey,
  mistral: hasMistralKey,
  llamacpp: hasLlamaCpp,
  groq: hasGroq,
  sambanova: hasSambaNova,
  llm7: hasLLM7,
};

// Soft check: warn if preferred provider missing, but allow fallback if ANY provider exists
const anyProvider = Object.values(providerKeys).some(Boolean);
if (!anyProvider) {
  console.error(
    'No API keys found in .env. Run "npm run setup" and add at least one provider key.'
  );
  process.exit(1);
}

if (!providerKeys[configuredProvider]) {
  console.warn(
    `[warn] Preferred provider "${configuredProvider}" has no key — will fallback to other available providers.`
  );
}

if (!config.model) {
  // Sensible defaults per provider
  const defaults = {
    groq: 'llama-3.3-70b-versatile',
    gemini: 'gemini-3.8-flash',
    openrouter: 'google/gemma-2-9b-it:free',
    mistral: 'mistral-small-latest',
    sambanova: 'Meta-Llama-3.3-70B-Instruct',
    llm7: 'default',
    llamacpp: 'local-model',
  };
  config.model = defaults[configuredProvider] || 'llama-3.3-70b-versatile';
}

if (!config.agentName) {
  config.agentName = 'Paijo';
}

console.log('');
console.log('  🦞 JongosAIFree v1.0.0');
console.log(`  Agent    : ${config.agentName}`);
console.log(`  Provider : ${configuredProvider}`);
console.log(`  Model    : ${config.model}`);
console.log('');

loadSkills();
startTelegram(config);
startWebUI(config);

console.log('\n  All systems go.\n');
