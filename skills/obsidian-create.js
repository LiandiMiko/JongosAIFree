const path = require('path');
const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  saveNote,
  buildNewNote,
} = require('../src/vault');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-create:\s*/i, '')
    .trim();

  // Agent sering kirim JSON: {"path":"...","content":"..."}
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return {
        notePath: String(obj.path || obj.note || '').trim(),
        content: String(obj.content || '').trim(),
      };
    } catch {
      // fallthrough
    }
  }

  // Format lama: path | content
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
  name: 'obsidian-create',
  description:
    'Buat note baru di vault Obsidian dengan format standar. ' +
    'Contoh: obsidian-create: {"path":"Inbox/Ide Baru.md","content":"ringkasan..."}',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-create:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const { notePath, content } = parseInput(text);
    if (!notePath) {
      return 'Path note wajib diisi. Contoh: Inbox/Ide Baru.md';
    }

    let rel = notePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel.toLowerCase().endsWith('.md')) {
      rel += '.md';
    }

    const abs = resolveNotePath(rel);
    const vaultDir = getVaultDir();

    if (!abs.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    const title = path.basename(rel, '.md');
    const finalContent = content
      ? buildNewNote({ title, body: content })
      : buildNewNote({ title });

    try {
      saveNote(abs, finalContent);
    } catch (err) {
      return `Gagal membuat note: ${err.message}`;
    }

    return `✅ Note dibuat: \`${rel}\`\nPath absolut: ${abs}`;
  },
};