const fs = require('fs');
const path = require('path');
const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  loadNote,
} = require('../src/vault');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-move:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return {
        from: String(obj.from || obj.path || '').trim(),
        to: String(obj.to || obj.dest || '').trim(),
      };
    } catch {
      // fallthrough
    }
  }

  // Format: from | to
  const parts = raw.split('|').map((p) => p.trim());
  if (parts.length >= 2) {
    return { from: parts[0], to: parts[1] };
  }

  return { from: raw, to: '' };
}

function ensureMd(rel) {
  let r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (r && !r.toLowerCase().endsWith('.md')) r += '.md';
  return r;
}

module.exports = {
  name: 'obsidian-move',
  description:
    'Pindahkan atau rename satu note .md di dalam vault. ' +
    'WAJIB approval. Contoh: obsidian-move: {"from":"Inbox/A.md","to":"Archive/A.md"}',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-move:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const { from, to } = parseInput(text);
    if (!from || !to) {
      return (
        'from dan to wajib diisi.\n' +
        'Contoh: obsidian-move: {"from":"Inbox/A.md","to":"Projects/A.md"}'
      );
    }

    const relFrom = ensureMd(from);
    const relTo = ensureMd(to);

    const absFrom = resolveNotePath(relFrom);
    const absTo = resolveNotePath(relTo);
    const vaultDir = getVaultDir();

    if (!absFrom.startsWith(vaultDir) || !absTo.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    if (!fs.existsSync(absFrom)) {
      return `Note sumber tidak ditemukan: \`${relFrom}\``;
    }

    if (fs.existsSync(absTo)) {
      return `Tujuan sudah ada: \`${relTo}\`. Hapus/rename dulu atau pilih nama lain.`;
    }

    const note = loadNote(absFrom);
    if (note?.sensitive) {
      return `Note \`${relFrom}\` ditandai sensitive dan tidak boleh dipindah otomatis.`;
    }

    try {
      fs.mkdirSync(path.dirname(absTo), { recursive: true });
      fs.renameSync(absFrom, absTo);
    } catch (err) {
      return `Gagal memindahkan note: ${err.message}`;
    }

    return `📦 Note dipindah:\n\`${relFrom}\` → \`${relTo}\``;
  },
};