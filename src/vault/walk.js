const fs = require('fs');
const path = require('path');
const { getVaultDir } = require('./paths');

/**
 * Ambil semua file .md di dalam vault (rekursif).
 * Skip folder/file yang diawali titik (mis. .obsidian).
 */
function walkMarkdownFiles(rootDir) {
  const base = rootDir || getVaultDir();
  const results = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;

      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }

  walk(base);
  return results;
}

module.exports = {
  walkMarkdownFiles,
};