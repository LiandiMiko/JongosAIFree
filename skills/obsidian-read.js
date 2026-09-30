const path = require('path');
const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
} = require('../src/vault');

function findNoteByNameOrPath(query) {
  const q = String(query || '').trim().replace(/\\/g, '/');
  if (!q) return null;

  const files = walkMarkdownFiles();
  const qLower = q.toLowerCase();
  const qBase = path.basename(qLower, '.md');

  // 1) exact relative path
  for (const file of files) {
    const note = loadNote(file);
    if (!note) continue;
    if (note.path.toLowerCase() === qLower) return note;
    if (note.path.toLowerCase() === qLower + '.md') return note;
  }

  // 2) exact note name
  for (const file of files) {
    const note = loadNote(file);
    if (!note) continue;
    if (note.nameLower === qBase) return note;
  }

  // 3) path / name contains query
  for (const file of files) {
    const note = loadNote(file);
    if (!note) continue;
    if (
      note.path.toLowerCase().includes(qLower) ||
      note.nameLower.includes(qBase)
    ) {
      return note;
    }
  }

  return null;
}

module.exports = {
  name: 'obsidian-read',
  description:
    'Baca isi satu note di vault Obsidian. ' +
    'Contoh: "obsidian-read: Fundamental Networking"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return (
      t.startsWith('obsidian-read:') ||
      t.startsWith('read:') ||
      t.startsWith('baca:')
    );
  },

  async run(text) {
    const query = String(text || '')
      .replace(/^(obsidian-read:|read:|baca:)\s*/i, '')
      .trim();

    if (!query) return 'Contoh: obsidian-read: Fundamental Networking';

    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const note = findNoteByNameOrPath(query);
    if (!note) {
      return `Note tidak ditemukan: "${query}"`;
    }

    if (note.sensitive) {
      return `Note "${note.path}" ditandai sensitive dan tidak dibacakan ke AI.`;
    }

    const maxLen = 8000;
    const body = note.content.length > maxLen
      ? note.content.slice(0, maxLen) + '\n\n…(dipotong)'
      : note.content;

    return [
      `📄 **${note.path}**`,
      note.tags.length ? `Tags: ${note.tags.map((t) => '#' + t).join(' ')}` : null,
      '',
      body,
    ]
      .filter(Boolean)
      .join('\n');
  },
};