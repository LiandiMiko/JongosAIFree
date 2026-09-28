const fs = require('fs');
const path = require('path');

const VAULT_DIR =
  process.env.OBSIDIAN_VAULT ||
  path.join(__dirname, '..', 'memory', 'second-brain');

const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules']);

function buildTree(dir, prefix = '', depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return [];

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort: folder dulu, alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const lines = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const isLast = i === entries.length - 1;
    const branch = isLast ? '└── ' : '├── ';
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');

    if (entry.isDirectory()) {
      const fullPath = path.join(dir, entry.name);
      const children = fs.readdirSync(fullPath, { withFileTypes: true });
      const mdCount = children.filter((c) => c.name.endsWith('.md')).length;
      const folderCount = children.filter((c) => c.isDirectory()).length;

      let label = entry.name;
      if (mdCount || folderCount) {
        const parts = [];
        if (mdCount) parts.push(`${mdCount} .md`);
        if (folderCount) parts.push(`${folderCount} folder`);
        label += ` (${parts.join(', ')})`;
      }

      lines.push(prefix + branch + label + '/');
      lines.push(...buildTree(fullPath, nextPrefix, depth + 1, maxDepth));
    } else if (entry.name.endsWith('.md')) {
      const stats = fs.statSync(path.join(dir, entry.name));
      const size = stats.size;
      const sizeLabel = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}K`;
      lines.push(prefix + branch + entry.name + ` (${sizeLabel})`);
    }
  }

  return lines;
}

function countAll(dir) {
  let mdCount = 0;
  let folderCount = 0;

  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        folderCount++;
        walk(path.join(d, entry.name));
      } else if (entry.name.endsWith('.md')) {
        mdCount++;
      }
    }
  }

  walk(dir);
  return { mdCount, folderCount };
}

module.exports = {
  name: 'obsidian-tree',
  description:
    'Tampilkan struktur folder (tree) vault Obsidian. ' +
    'Contoh: "obsidian-tree" atau "obsidian-tree: 04 Knowledge".',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return (
      t === 'obsidian-tree' ||
      t.startsWith('obsidian-tree:') ||
      t === 'tree' ||
      t.startsWith('tree:')
    );
  },

  async run(text) {
    const stripped = text.trim().toLowerCase();
    const query =
      stripped === 'obsidian-tree' || stripped === 'tree'
        ? ''
        : text.replace(/^(obsidian-tree:|tree:)\s*/i, '').trim();

    const targetDir = query
      ? path.resolve(VAULT_DIR, query)
      : VAULT_DIR;

    // Validasi targetDir di dalam vault
    if (!targetDir.startsWith(path.resolve(VAULT_DIR))) {
      return '❌ Path di luar vault.';
    }

    if (!fs.existsSync(targetDir)) {
      return `❌ Folder tidak ditemukan: ${query}`;
    }

    const stats = fs.statSync(targetDir);
    if (!stats.isDirectory()) {
      return `❌ Bukan folder: ${query}`;
    }

    const { mdCount, folderCount } = countAll(targetDir);
    const relName = query
      ? path.relative(VAULT_DIR, targetDir)
      : path.basename(VAULT_DIR);

    const lines = [];
    lines.push(`📁 **${relName}/**`);
    lines.push('');
    lines.push('```');
    lines.push(`${relName}/`);
    lines.push(...buildTree(targetDir));
    lines.push('```');
    lines.push('');
    lines.push(`📊 Total: **${mdCount}** file .md, **${folderCount}** folder`);

    return lines.join('\n');
  },
};
