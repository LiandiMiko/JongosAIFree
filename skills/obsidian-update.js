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
    .replace(/^obsidian-update:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return {
        notePath: String(obj.path || '').trim(),
        content: String(obj.content || ''),
      };
    } catch {
      // fallthrough
    }
  }

  const parts = raw.split('|');
  if (parts.length >= 2) {
    return {
      notePath: parts[0].trim(),
      content: parts.slice(1).join('|'),
    };
  }

  return { notePath: raw, content: '' };
}

module.exports = {
  name: 'obsidian-update',
  description:
    'Ganti seluruh isi note yang sudah ada. ' +
    'Contoh: obsidian-update: {"path":"Inbox/Ide.md","content":"# Judul\\n\\nisi baru"}',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-update:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const { notePath, content } = parseInput(text);
    if (!notePath) return 'Path note wajib diisi.';
    if (!content && content !== '') {
      return 'Content baru wajib diisi (bisa string kosong hanya jika memang sengaja).';
    }
    if (String(content).trim() === '' && content !== '') {
      // keep allow empty only if explicitly empty string from JSON
    }
    if (content === undefined || content === null) {
      return 'Content baru wajib diisi.';
    }
    if (String(text).includes('"content"') === false && String(content).trim() === '' && !String(text).includes('|')) {
      return 'Content baru wajib diisi.';
    }

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

    const existing = loadNote(abs);
    if (!existing) return `Gagal membaca note: \`${rel}\``;

    if (existing.sensitive) {
      return `Note \`${rel}\` ditandai sensitive dan tidak boleh diubah otomatis.`;
    }

    if (String(content).trim() === '') {
      return 'Content baru kosong. Batalkan update untuk mencegah note terhapus isinya.';
    }

    const next = touchUpdated(String(content));

    try {
      saveNote(abs, next);
    } catch (err) {
      return `Gagal update: ${err.message}`;
    }

    return `✅ Note di-update: \`${rel}\``;
  },
};