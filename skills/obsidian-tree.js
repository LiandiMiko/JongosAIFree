const fs = require('fs');
const path = require('path');
const { getVaultDir, vaultExists } = require('../src/vault');

function listTree(dir, prefix = '', maxDepth = 4, depth = 0) {
  if (depth > maxDepth) return [];
  if (!fs.existsSync(dir)) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  entries = entries
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  const lines = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const isLast = i === entries.length - 1;
    const branch = isLast ? '└─ ' : '├─ ';
    const nextPrefix = prefix + (isLast ? '   ' : '│  ');
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      lines.push(`${prefix}${branch}📁 ${entry.name}/`);
      lines.push(...listTree(full, nextPrefix, maxDepth, depth + 1));
    } else if (entry.name.endsWith('.md')) {
      lines.push(`${prefix}${branch}📄 ${entry.name}`);
    }
  }

  return lines;
}

module.exports = {
  name: 'obsidian-tree',
  description:
    'Tampilkan struktur folder vault Obsidian. ' +
    'Contoh: "obsidian-tree" atau "obsidian-tree: 1.1 Main"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t === 'obsidian-tree' || t.startsWith('obsidian-tree:');
  },

    async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const vaultDir = getVaultDir();
    let rel = String(text || '').trim();

    // Hapus prefix command
    rel = rel.replace(/^obsidian-tree:\s*/i, '').trim();

    // Kalau user hanya ketik "obsidian-tree" → artinya root vault
    if (!rel || rel.toLowerCase() === 'obsidian-tree') {
      rel = '';
    }

    rel = rel.replace(/\\/g, '/');

    const target = rel ? path.resolve(vaultDir, rel) : vaultDir;

    if (!target.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    if (!fs.existsSync(target)) {
      return `Folder tidak ditemukan: ${rel || '(root)'}`;
    }

    const lines = listTree(target, '', 4, 0);
    if (!lines.length) return 'Folder kosong.';

    return [
      `🌳 **Vault tree** — ${rel || '(root)'}`,
      `Path: ${vaultDir}`,
      '',
      ...lines,
    ].join('\n');
  },
};