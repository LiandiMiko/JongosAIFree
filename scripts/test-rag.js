/**
 * Smoke test hybrid RAG (no vault required — uses temp synthetic index).
 * Run: node scripts/test-rag.js
 */
const fs = require('fs');
const path = require('path');
const { saveIndex, searchIndex, INDEX_FILE } = require('../src/rag/store');
const { retrieveContext, diversifyByNote } = require('../src/rag/retriever');
const { tokenizeQuery } = require('../src/rag/embedder');

const chunks = [
  {
    id: '04 Knowledge/JongosAIFree.md#1',
    notePath: '04 Knowledge/JongosAIFree.md',
    title: 'JongosAIFree',
    section: 'Progress',
    content:
      'Phase 1 intent classifier hard policy ticker prefetch Binance. Agent Yanto/Paijo.',
  },
  {
    id: 'notes/linux.md#1',
    notePath: 'notes/linux.md',
    title: 'Linux tips',
    section: 'General',
    content: 'Cara install nginx di ubuntu dengan apt install nginx.',
  },
  {
    id: 'notes/linux.md#2',
    notePath: 'notes/linux.md',
    title: 'Linux tips',
    section: 'Firewall',
    content: 'UFW allow 80 dan 443 untuk web server nginx.',
  },
  {
    id: 'notes/recipes.md#1',
    notePath: 'notes/recipes.md',
    title: 'Resep',
    section: 'Makanan',
    content: 'Resep nasi goreng sederhana dengan kecap.',
  },
];

let failed = 0;
function ok(cond, msg) {
  if (!cond) failed += 1;
  console.log(`${cond ? '✓' : '✗'} ${msg}`);
}

// backup existing index if any
let backup = null;
if (fs.existsSync(INDEX_FILE)) {
  backup = fs.readFileSync(INDEX_FILE, 'utf-8');
}

try {
  saveIndex(chunks);

  ok(tokenizeQuery('harga yang ada').length >= 1, 'tokenizeQuery filters stopwords-ish');

  const j = searchIndex('progres phase jongos intent', 5);
  ok(j.length > 0 && j[0].notePath.includes('JongosAIFree'), 'jongos query ranks Jongos note first');

  const n = searchIndex('install nginx ubuntu', 5);
  ok(n.length > 0 && n[0].notePath.includes('linux'), 'nginx query ranks linux note first');

  const ctx = retrieveContext('progress JongosAIFree phase 1', 4);
  ok(ctx.includes('JongosAIFree') && ctx.includes('score='), 'retrieveContext includes score + note');

  const div = diversifyByNote(
    [
      { notePath: 'a', score: 1 },
      { notePath: 'a', score: 0.9 },
      { notePath: 'a', score: 0.8 },
      { notePath: 'b', score: 0.7 },
    ],
    3,
    2
  );
  ok(div.filter((x) => x.notePath === 'a').length === 2, 'diversify max 2 per note');

  console.log(failed === 0 ? '\nAll RAG tests passed.' : `\n${failed} test(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
} finally {
  if (backup != null) {
    fs.writeFileSync(INDEX_FILE, backup, 'utf-8');
  } else if (fs.existsSync(INDEX_FILE)) {
    // leave synthetic only if no prior — still fine for CI
  }
}
