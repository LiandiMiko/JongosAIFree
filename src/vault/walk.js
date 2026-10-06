const fs = require('fs');
const path = require('path');
const { getVaultDir } = require('./paths');

/**
 * Ambil semua file .md di dalam vault (rekursif).
 * Skip folder/file yang diawali titik (mis. .obsidian).
 * Dilengkapi cycle detection & depth limit untuk mencegah infinite loop.
 */
function walkMarkdownFiles(rootDir) {
  const base = rootDir || getVaultDir();
  const results = [];
  const visited = new Set();

  function walk(dir, depth) {
    if (depth > 30) return; // max depth guard
    if (!fs.existsSync(dir)) return;

    // Cycle detection via real path
    try {
      const real = fs.realpathSync(dir);
      if (visited.has(real)) return;
      visited.add(real);
    } catch {
      return;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (/\.md$/i.test(entry.name)) { // case-insensitive
        results.push(full);
      }
    }
  }

  walk(base, 0);
  return results;
}

module.exports = {
  walkMarkdownFiles,
};