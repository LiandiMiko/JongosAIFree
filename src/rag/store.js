const fs = require('fs');
const path = require('path');
const { computeTermFrequency, cosineSimilarity } = require('./embedder');

const DATA_DIR = path.join(process.cwd(), 'data', 'rag');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveIndex(chunks) {
  ensureDataDir();
  const indexed = chunks.map((chunk) => ({
    ...chunk,
    tf: computeTermFrequency(chunk.content),
  }));

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

function searchIndex(query, topK = 3) {
  const index = loadIndex();
  if (!index.length) return [];

  const queryTf = computeTermFrequency(query);
  const scored = index.map((chunk) => {
    const score = cosineSimilarity(queryTf, chunk.tf || computeTermFrequency(chunk.content));
    return { ...chunk, score };
  });

  return scored
    .filter((item) => item.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

module.exports = {
  saveIndex,
  loadIndex,
  searchIndex,
};
