// Android Bionic patch — MUST be first line before any other require
const os = require('os');
const _orig = os.networkInterfaces.bind(os);
os.networkInterfaces = () => { try { return _orig(); } catch { return {}; } };

// Now safe to require everything else
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { loadSkills } = require('./src/skills');
const { startTelegram } = require('./src/telegram');
const { startWebUI } = require('./src/webui');

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Check config exists
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('No config.json found. Run "node setup.js" first.');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
} catch (err) {
  console.error('Failed to parse config.json:', err.message);
  process.exit(1);
}

// Validate required fields
const hasGeminiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3;
const hasOpenRouterKey = process.env.OPENROUTER_API_KEY;
const hasMistralKey = process.env.MISTRAL_API_KEY;
const hasLlamaCpp = !!process.env.LLAMACPP_URL;
const hasGroq = !!process.env.GROQ_API_KEY;

const configuredProvider = (config.provider || "gemini").toLowerCase();
const providerKeys = {
  gemini: hasGeminiKey,
  openrouter: hasOpenRouterKey,
  mistral: hasMistralKey,
  llamacpp: hasLlamaCpp,
  groq: hasGroq,
};

if (!providerKeys[configuredProvider]) {
  console.error(`Missing API key for provider "${configuredProvider}" in .env`);
  process.exit(1);
}

if (!config.model) {
  config.model = 'gemini-3.8-flash';
}

console.log(`\n  Clawd Agent v1.0.0`);
console.log(`  Agent: ${config.agentName || 'Clawd'}`);
console.log(`  Model: ${config.model}`);
console.log('');

// Load skill plugins
loadSkills();

// Start gateways
startTelegram(config);
startWebUI(config);

console.log('\n  All systems go.\n');
