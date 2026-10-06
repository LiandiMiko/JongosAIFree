const { searchIndex, loadIndex } = require('./store');

/**
 * Diversify: max `perNote` chunks from the same notePath.
 */
function diversifyByNote(matches, topK, perNote = 2) {
  const out = [];
  const counts = new Map();
  for (const m of matches) {
    const key = m.notePath || m.id || '';
    const n = counts.get(key) || 0;
    if (n >= perNote) continue;
    counts.set(key, n + 1);
    out.push(m);
    if (out.length >= topK) break;
  }
  return out;
}

function retrieveContext(query, topK = 4) {
  const index = loadIndex();
  if (!index.length) {
    return [
      '## KONTEKS VAULT (RAG):',
      'Index kosong atau belum di-build. Jalankan: npm run reindex',
      '--- END KONTEKS ---',
    ].join('\n');
  }

  const raw = searchIndex(query, topK);
  const matches = diversifyByNote(raw, topK, 2);

  if (!matches.length) {
    return '';
  }

  const contextBlocks = matches.map((m, idx) => {
    const score = typeof m.score === 'number' ? m.score.toFixed(3) : '?';
    const title = m.title && m.title !== m.notePath ? ` | Title: ${m.title}` : '';
    return (
      `--- Context #${idx + 1} [score=${score}] [Note: ${m.notePath}${title} | Section: ${m.section}] ---\n` +
      `${m.content}`
    );
  });

  return [
    '## KONTEKS OTOMATIS DARI VAULT OBSIDIAN (RAG):',
    'Gunakan HANYA jika relevan dengan pertanyaan user tentang catatan/project. Abaikan jika tidak relevan.',
    ...contextBlocks,
    '--- END KONTEKS ---',
  ].join('\n\n');
}

module.exports = {
  retrieveContext,
  diversifyByNote,
};
