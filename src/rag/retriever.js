const { searchIndex } = require('./store');

function retrieveContext(query, topK = 3) {
  const matches = searchIndex(query, topK);
  if (!matches || matches.length === 0) {
    return '';
  }

  const contextBlocks = matches.map((m, idx) => {
    return `--- Context #${idx + 1} [Note: ${m.notePath} | Section: ${m.section}] ---\n${m.content}`;
  });

  return [
    '## KONTEKS OTOMATIS DARI VAULT OBSIDIAN (RAG):',
    ...contextBlocks,
    '--- END KONTEKS ---',
  ].join('\n\n');
}

module.exports = {
  retrieveContext,
};
