const fs = require('fs');
const path = require('path');

const VAULT_DIR =
  process.env.OBSIDIAN_VAULT ||
  path.join(__dirname, '..', 'memory', 'second-brain');

function resolveVaultPath(relPath) {
  const clean = relPath.replace(/^\/+/, '').replace(/\\/g, '/').trim();
  if (!clean) throw new Error('Path kosong.');
  if (clean.split('/').some((seg) => seg === '..')) {
    throw new Error('Path tidak boleh mengandung "..".');
  }
  if (path.isAbsolute(clean)) {
    throw new Error('Path harus relatif terhadap vault.');
  }
  const full = path.resolve(VAULT_DIR, clean);
  const vaultResolved = path.resolve(VAULT_DIR);
  if (!full.startsWith(vaultResolved + path.sep) && full !== vaultResolved) {
    throw new Error('Path keluar dari vault.');
  }
  return full;
}

module.exports = {
  name: 'obsidian-append',
  description:
    'Tambah konten di akhir note .md yang sudah ada di vault Obsidian. ' +
    'Butuh approval. Args: {path, content}.',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('obsidian-append:') || t.startsWith('append note:');
  },

  async run(input) {
    const json = input.replace(/^(obsidian-append:|append note:)\s*/i, '').trim();

    let args;
    try {
      args = JSON.parse(json);
    } catch (e) {
      return `Format input salah: ${e.message}`;
    }

    const { path: relPath, content } = args;

    if (!relPath || typeof relPath !== 'string') {
      return 'Arg "path" wajib diisi.';
    }
    if (typeof content !== 'string' || !content) {
      return 'Arg "content" wajib diisi.';
    }

    let fullPath;
    try {
      fullPath = resolveVaultPath(relPath);
    } catch (e) {
      return `Path tidak valid: ${e.message}`;
    }

    if (!fullPath.endsWith('.md')) fullPath += '.md';

    if (!fs.existsSync(fullPath)) {
      return `Note tidak ditemukan: ${path.relative(VAULT_DIR, fullPath)}\nGunakan obsidian-create dulu.`;
    }

    try {
      const original = fs.readFileSync(fullPath, 'utf-8');
      const needsNewline = original.length > 0 && !original.endsWith('\n');
      const separator = needsNewline ? '\n\n' : '\n';
      const addition = separator + content;

      fs.appendFileSync(fullPath, addition, 'utf-8');

      const rel = path.relative(VAULT_DIR, fullPath);
      const addedLines = content.split('\n').length;
      const before = original.length;
      const after = fs.statSync(fullPath).size;

      return `✅ Appended ke: ${rel}\n➕ +${addedLines} baris, +${after - before} char.`;
    } catch (e) {
      return `Gagal append: ${e.message}`;
    }
  },
};
