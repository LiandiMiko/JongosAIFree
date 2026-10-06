const fs = require('fs');
const path = require('path');
const {
  computeTermFrequency,
  cosineSimilarity,
  tokenizeQuery,
  keywordCoverage,
  metadataBoost,
} = require('./embedder');

const DATA_DIR = path.join(process.cwd(), 'data', 'rag');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveIndex(chunks) {
  ensureDataDir();
  const indexed = chunks.map((chunk) => {
    const blob = [chunk.title, chunk.section, chunk.content].filter(Boolean).join('\n');
    return {
      ...chunk,
      tf: computeTermFrequency(blob),
    };
  });

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexed, null, 2), 'utf-8');
  return indexed.length;
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[rag] Gagal membaca index.json:', err.message);
    return [];
  }
}

/**
 * Hybrid lexical search:
 * score = 0.45 * cosine(tf) + 0.35 * keywordCoverage + 0.20 * metadataBoost
 */
function searchIndex(query, topK = 5) {
  const index = loadIndex();
  if (!index.length) return [];

  const qTokens = tokenizeQuery(query);
  if (!qTokens.length) return [];

  const queryTf = computeTermFrequency(query);

  const scored = index.map((chunk) => {
    const blob = [chunk.title, chunk.section, chunk.content].filter(Boolean).join('\n');
    const cosine = cosineSimilarity(queryTf, chunk.tf || computeTermFrequency(blob));
    const kw = keywordCoverage(qTokens, blob);
    const meta = metadataBoost(qTokens, chunk);
    const score = 0.45 * cosine + 0.35 * kw + 0.2 * meta;
    return { ...chunk, score, _parts: { cosine, kw, meta } };
  });

  return scored
    .filter((item) => item.score > 0.04)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(topK * 3, topK)); // over-fetch; retriever may diversify
}

module.exports = {
  saveIndex,
  loadIndex,
  searchIndex,
  INDEX_FILE,
  DATA_DIR,
};
