/**
 * Smoke test for Phase 1 intent classifier + hard tool policy.
 * Run: node scripts/test-intent.js
 */
const {
  classifyIntent,
  isRealtimeQuery,
} = require('../src/agent/decision');
const { checkHardToolPolicy } = require('../src/agent/tool-executor');

const cases = [
  ['harga btc sekarang', 'realtime'],
  ['berapa harga bitcoin', 'realtime'],
  ['cuaca jakarta hari ini', 'realtime'],
  ['jam berapa sekarang', 'time'],
  ['tanggal berapa hari ini', 'time'],
  ['status provider', 'status'],
  ['cek kuota gemini', 'status'],
  ['/status', 'status'],
  ['baca note tentang linux', 'vault'],
  ['cari di vault soal project jongos', 'vault'],
  ['list folder vault', 'vault'],
  ['jalankan command shell uptime', 'shell'],
  ['halo apa kabar', 'general'],
  ['jelaskan apa itu RAG', 'general'],
];

let failed = 0;
console.log('=== classifyIntent ===');
for (const [text, expected] of cases) {
  const got = classifyIntent(text);
  const ok = got.type === expected;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} "${text}" → ${got.type} (expected ${expected})`);
}

console.log('\n=== isRealtimeQuery compat ===');
const rtCases = [
  ['harga eth', true],
  ['baca note harga eth kemarin', false], // vault should win if explicit note
];
for (const [text, expected] of rtCases) {
  const got = isRealtimeQuery(text);
  // Note: "baca note harga eth kemarin" → vault, so isRealtimeQuery false
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} isRealtimeQuery("${text}") = ${got} (expected ${expected})`);
}

console.log('\n=== hard tool policy ===');
const policyCases = [
  [
    'shell',
    { command: 'curl https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT' },
    true,
  ],
  ['shell', { command: 'date' }, true],
  ['shell', { command: 'pwd && ls' }, true],
  ['shell', { command: 'uptime' }, false],
  ['fetch', { url: 'not-a-url' }, true],
  ['fetch', { url: 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT' }, false],
];

for (const [tool, args, shouldBlock] of policyCases) {
  const r = checkHardToolPolicy(tool, args, {});
  const ok = r.blocked === shouldBlock;
  if (!ok) failed++;
  console.log(
    `${ok ? '✓' : '✗'} ${tool} ${JSON.stringify(args).slice(0, 60)} → blocked=${r.blocked} (expected ${shouldBlock})`
  );
}

// Intent-aware block
const intentBlock = checkHardToolPolicy(
  'shell',
  { command: 'uptime' },
  { intent: { type: 'realtime', blockTools: ['shell'] } }
);
const okIntent = intentBlock.blocked === true;
if (!okIntent) failed++;
console.log(
  `${okIntent ? '✓' : '✗'} shell blocked by realtime intent → ${intentBlock.blocked}`
);

console.log(failed === 0 ? '\nAll tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
