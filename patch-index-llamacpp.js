const fs = require('fs');
const p = 'index.js';
let s = fs.readFileSync(p, 'utf8');

const oldBlock = `const hasGeminiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3;
const hasOpenRouterKey = process.env.OPENROUTER_API_KEY;
const hasMistralKey = process.env.MISTRAL_API_KEY;

const configuredProvider = (config.provider || "gemini").toLowerCase();
const providerKeys = { gemini: hasGeminiKey, openrouter: hasOpenRouterKey, mistral: hasMistralKey };`;

const newBlock = `const hasGeminiKey = process.env.GEMINI_API_KEY_1 || process.env.GEMINI_API_KEY_2 || process.env.GEMINI_API_KEY_3;
const hasOpenRouterKey = process.env.OPENROUTER_API_KEY;
const hasMistralKey = process.env.MISTRAL_API_KEY;
const hasLlamaCpp = !!process.env.LLAMACPP_URL;

const configuredProvider = (config.provider || "gemini").toLowerCase();
const providerKeys = {
  gemini: hasGeminiKey,
  openrouter: hasOpenRouterKey,
  mistral: hasMistralKey,
  llamacpp: hasLlamaCpp,
};`;

if (!s.includes(oldBlock)) throw new Error('anchor not found');
if (s.includes('hasLlamaCpp')) throw new Error('already patched');
s = s.replace(oldBlock, newBlock);

fs.writeFileSync(p, s);
console.log('INDEX LLAMACPP PATCH OK');
