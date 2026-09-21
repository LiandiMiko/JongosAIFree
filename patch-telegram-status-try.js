const fs = require('fs');
const p = 'src/telegram.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `    // === /status command intercept (before LLM) ===`;

const replacement = `    // === /status command intercept (before LLM) ===`;

// Only patch if not already wrapped
if (s.includes('// /status already wrapped')) {
  console.log('ALREADY WRAPPED');
  process.exit(0);
}

// Find the block, wrap it
const startMarker = `    // === /status command intercept (before LLM) ===\n`;
const endMarker = `    // === end /status ===\n`;

const startIdx = s.indexOf(startMarker);
const endIdx = s.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) throw new Error('Markers not found');

const before = s.slice(0, startIdx);
const block = s.slice(startIdx + startMarker.length, endIdx);
const after = s.slice(endIdx + endMarker.length);

const indented = block
  .split('\n')
  .map(line => line ? '  ' + line : line)
  .join('\n');

const wrapped =
  `    // /status already wrapped\n` +
  `    // === /status command intercept (before LLM) ===\n` +
  `    try {\n` +
  indented +
  `\n    } catch (e) {\n` +
  `      console.error('[telegram] /status error:', e.message);\n` +
  `      await ctx.reply('❌ /status error: ' + e.message).catch(() => {});\n` +
  `      return;\n` +
  `    }\n` +
  `    // === end /status ===\n`;

fs.writeFileSync(p, before + wrapped + after);
console.log('STATUS TRY-WRAP OK');
