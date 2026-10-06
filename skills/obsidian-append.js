const fs = require('fs');
const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  loadNote,
  saveNote,
  touchUpdated,
} = require('../src/vault');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-append:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return {
        notePath: String(obj.path || obj.note || '').trim(),
        content: String(obj.content || obj.text || '').trim(),
      };
    } catch {
      // fallthrough
    }
  }

  const parts = raw.split('|');
  if (parts.length >= 2) {
    return {
      notePath: parts[0].trim(),
      content: parts.slice(1).join('|').trim(),
    };
  }

  return { notePath: raw, content: '' };
}

module.exports = {
  name: 'obsidian-append',
  description:
    'Tambah teks di akhir note yang sudah ada. ' +
    'Contoh: obsidian-append: {"path":"Inbox/Ide.md","content":"baris baru"}',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-append:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const { notePath, content } = parseInput(text);
    if (!notePath) return 'Path note wajib diisi.';
    if (!content) return 'Content yang mau ditambahkan wajib diisi.';

    let rel = notePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel.toLowerCase().endsWith('.md')) rel += '.md';

    const abs = resolveNotePath(rel);
    const vaultDir = getVaultDir();

    if (!abs.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    if (!fs.existsSync(abs)) {
      return `Note tidak ditemukan: \`${rel}\``;
    }

    const note = loadNote(abs);
    if (!note) return `Gagal membaca note: \`${rel}\``;

    if (note.sensitive) {
      return `Note \`${rel}\` ditandai sensitive dan tidak boleh diubah otomatis.`;
    }

    const next = touchUpdated(
      String(note.content || '').replace(/\s*$/, '') + '\n\n' + content + '\n'
    );

    try {
      saveNote(abs, next);
    } catch (err) {
      return `Gagal append: ${err.message}`;
    }

    return `✅ Append berhasil ke \`${rel}\``;
  },
};