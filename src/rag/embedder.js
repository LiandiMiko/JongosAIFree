/**
 * Lightweight lexical "embedding" helpers for local RAG.
 * No external model — TF + token overlap, bagus untuk vault kecil/menengah.
 */

/** Indonesian + English stopwords (singkat) — tetap index, tapi optional downweight di scorer */
const STOPWORDS = new Set(
  `
  yang dan di ke dari untuk dengan pada adalah itu ini atau sebagai
  the a an and or of to in on for is are was were be been by with as at
  ada dari sudah akan bisa ada saya aku kamu kita mereka
  `.trim().split(/\s+/)
);

function tokenize(text) {
  return (
    String(text || '')
      // split camelCase / PascalCase: JongosAIFree → Jongos AI Free
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Za-z])([0-9])/g, '$1 $2')
      .toLowerCase()
      // FIX C16: Escape hyphen to prevent unintended char range /_- (ASCII 47→95)
      // which accidentally kept colons, semicolons, brackets, question marks, etc.
      .replace(/[^\p{L}\p{N}\s/_\-]+/gu, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1)
  );
}

function tokenizeQuery(text) {
  // FIX D10: Strictly remove all stopwords from query tokens.
  // The old condition `|| w.length >= 5` kept long stopwords like
  // 'adalah', 'dengan', 'mereka' (6-7 chars) defeating the stopword filter.
  return tokenize(text).filter((w) => !STOPWORDS.has(w));
}


function computeTermFrequency(text) {
  const tokens = tokenize(text);
  const tf = {};
  if (tokens.length === 0) return tf;

  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }

  const n = tokens.length;
  for (const t of Object.keys(tf)) {
    tf[t] = tf[t] / n;
  }

  return tf;
}

function cosineSimilarity(tf1, tf2) {
  const keys = new Set([...Object.keys(tf1 || {}), ...Object.keys(tf2 || {})]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const k of keys) {
    const valA = tf1[k] || 0;
    const valB = tf2[k] || 0;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Fraction of query tokens that appear in doc tokens (0..1). Supports substring (jongos ⊂ jongosaifree). */
function keywordCoverage(queryTokens, docText) {
  if (!queryTokens.length) return 0;
  const docTokens = tokenize(docText);
  const docSet = new Set(docTokens);
  const docJoined = docTokens.join(' ');
  let hits = 0;
  for (const q of queryTokens) {
    if (docSet.has(q)) {
      hits += 1;
      continue;
    }
    // partial: query token is prefix/substring of a doc token or vice versa (len>=3)
    if (q.length >= 3) {
      const partial = docTokens.some(
        (d) => d.includes(q) || (d.length >= 3 && q.includes(d))
      );
      if (partial || docJoined.includes(q)) hits += 1;
    }
  }
  return hits / queryTokens.length;
}

/** Boost if path/title/section contains query tokens. */
function metadataBoost(queryTokens, chunk) {
  if (!queryTokens.length) return 0;
  const meta = `${chunk.notePath || ''} ${chunk.title || ''} ${chunk.section || ''}`.toLowerCase();
  const metaTokens = new Set(tokenize(meta));
  let hits = 0;
  for (const q of queryTokens) {
    if (metaTokens.has(q) || meta.includes(q)) hits += 1;
  }
  return hits / queryTokens.length;
}

module.exports = {
  STOPWORDS,
  tokenize,
  tokenizeQuery,
  computeTermFrequency,
  cosineSimilarity,
  keywordCoverage,
  metadataBoost,
};
