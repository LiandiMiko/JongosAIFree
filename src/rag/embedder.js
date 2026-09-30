function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function computeTermFrequency(text) {
  const tokens = tokenize(text);
  const tf = {};
  if (tokens.length === 0) return tf;

  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }

  for (const t of Object.keys(tf)) {
    tf[t] = tf[t] / tokens.length;
  }

  return tf;
}

function cosineSimilarity(tf1, tf2) {
  const keys = new Set([...Object.keys(tf1), ...Object.keys(tf2)]);
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

module.exports = {
  tokenize,
  computeTermFrequency,
  cosineSimilarity,
};
