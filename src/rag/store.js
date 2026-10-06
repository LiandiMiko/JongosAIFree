const fs = require('fs');
const path = require('path');
const {
  computeTermFrequency,
  cosineSimilarity,
  tokenizeQuery,
  keywordCoverage,
  metadataBoost,
} = require('./embedder');

// FIX C14: Use __dirname for reliable path resolution instead of process.cwd()
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'rag');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

// FIX D9: In-memory cache to avoid repeated disk reads on every query
let cachedIndex = null;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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

  // FIX C13 & D8: Atomic write (tmp → rename) + compact JSON (no pretty-print)
  const tmpFile = `${INDEX_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(indexed), 'utf-8');
  fs.renameSync(tmpFile, INDEX_FILE);

  // Invalidate and update cache
  cachedIndex = indexed;

  return indexed.length;
}

function loadIndex() {
  // FIX D9: Return from cache if available
  if (cachedIndex !== null) return cachedIndex;

  if (!fs.existsSync(INDEX_FILE)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf-8');
    cachedIndex = JSON.parse(raw);
    return cachedIndex;
  } catch (err) {
    console.error('[rag] Gagal membaca index.json:', err.message);
    return [];
  }
}

/** Invalidate the in-memory index cache (call after reindex). */
function invalidateCache() {
  cachedIndex = null;
}

/**
 * Hybrid lexical search:
 * score = 0.45 * cosine(tf) + 0.35 * keywordCoverage + 0.20 * metadataBoost
 */
function searchIndex(query, topK = 5) {
  // FIX Q18: Use a single loadIndex call; pass preloaded index directly
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
  invalidateCache,
  INDEX_FILE,
  DATA_DIR,
};
