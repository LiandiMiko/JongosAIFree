const fs = require('fs');
const p = 'src/agent-loop.js';
let s = fs.readFileSync(p, 'utf8');

// Cari validasi action di parseAgentDecision
const anchor = `  if (!decision || typeof decision !== 'object') {`;

const addition = `  // === DEBUG: log raw decision ===
  if (decision && typeof decision === 'object') {
    console.log('[agent] Parsed decision:', JSON.stringify(decision).slice(0, 300));
  }
  // === end debug ===

  if (!decision || typeof decision !== 'object') {`;

if (!s.includes(anchor)) throw new Error('anchor not found');
if (s.includes('[agent] Parsed decision')) throw new Error('already patched');
s = s.replace(anchor, addition);

fs.writeFileSync(p, s);
console.log('DEBUG ACTION OK');
