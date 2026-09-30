const fs = require('fs');
const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  loadNote,
} = require('../src/vault');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-delete:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return String(obj.path || obj.note || '').trim();
    } catch {
      // fallthrough
    }
  }

  return raw;
}

module.exports = {
  name: 'obsidian-delete',
  description:
    'Hapus satu note .md dari vault Obsidian. ' +
    'WAJIB approval. Contoh: obsidian-delete: Inbox/Draft.md',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-delete:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    let rel = parseInput(text);
    if (!rel) {
      return 'Path note wajib diisi. Contoh: obsidian-delete: Inbox/Draft.md';
    }

    rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel.toLowerCase().endsWith('.md')) {
      rel += '.md';
    }

    const abs = resolveNotePath(rel);
    const vaultDir = getVaultDir();

    if (!abs.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    if (!fs.existsSync(abs)) {
      return `Note tidak ditemukan: \`${rel}\``;
    }

    const note = loadNote(abs);
    if (note?.sensitive) {
      return `Note \`${rel}\` ditandai sensitive dan tidak boleh dihapus otomatis.`;
    }

    try {
      fs.unlinkSync(abs);
    } catch (err) {
      return `Gagal menghapus note: ${err.message}`;
    }

    return `🗑️ Note dihapus: \`${rel}\``;
  },
};