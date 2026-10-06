const { classifyIntent } = require('../src/agent/decision');
const { getModelsForTier, PROVIDERS } = require('../src/providers');

function ok(cond, msg) {
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) process.exit(1);
}

console.log('=== TEST SMART MODEL ROUTING & LOAD BALANCING ===\n');

// 1. Check Light Tier (RAG, lookup, Q&A)
const iLight1 = classifyIntent('buka 30 baris awal Fundamental Networking.md');
ok(iLight1.tier === 'light', 'RAG / Note reading query → LIGHT tier');

const iLight2 = classifyIntent('siapa nama agen kamu?');
ok(iLight2.tier === 'light', 'General Q&A query → LIGHT tier');

const iLight3 = classifyIntent('harga btc sekarang');
ok(iLight3.tier === 'light', 'Realtime ticker query → LIGHT tier');

// 2. Check Heavy Tier (coding, debug, script, shell, refactor)
const iHeavy1 = classifyIntent('buatkan script node.js untuk refactor data');
ok(iHeavy1.tier === 'heavy', 'Coding query → HEAVY tier');

const iHeavy2 = classifyIntent('jalankan command shell uptime');
ok(iHeavy2.tier === 'heavy', 'Shell command query → HEAVY tier');

const iHeavy3 = classifyIntent('debug fungsi ini dan perbaiki bug');
ok(iHeavy3.tier === 'heavy', 'Debugging query → HEAVY tier');

// 3. Test getModelsForTier ordering
const geminiLight = getModelsForTier('gemini', 'light');
ok(geminiLight[0].includes('flash-lite') || geminiLight[0].includes('2.5-flash') || geminiLight[0].includes('2.0-flash'), 'Gemini LIGHT tier starts with lightweight flash models');

const geminiHeavy = getModelsForTier('gemini', 'heavy');
ok(geminiHeavy[0] === 'gemini-3.8-flash' || geminiHeavy[0] === 'gemini-3.6-flash', 'Gemini HEAVY tier starts with heavy 3.8/3.6 models');

const groqLight = getModelsForTier('groq', 'light');
ok(groqLight[0] === 'llama-3.1-8b-instant', 'Groq LIGHT tier starts with 8b instant model');

const groqHeavy = getModelsForTier('groq', 'heavy');
ok(groqHeavy[0] === 'llama-3.3-70b-versatile', 'Groq HEAVY tier starts with 70b versatile model');

console.log('\nAll Smart Model Routing & Load Balancing tests passed successfully!');
