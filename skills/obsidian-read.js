const fs = require('fs');
const path = require('path');

const VAULT_DIR =
  process.env.OBSIDIAN_VAULT ||
  path.join(__dirname, '..', 'memory', 'second-brain');

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function findNote(query) {
  const q = query.trim().replace(/\.md$/i, '').toLowerCase();
  if (!q) return null;

  // 1. Exact path relative to vault
  const exact = path.join(VAULT_DIR, query.endsWith('.md') ? query : `${query}.md`);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return exact;

  const all = walk(VAULT_DIR);

  // 2. Exact filename match (without .md), case-insensitive
  const exactName = all.find(
    (f) => path.basename(f, '.md').toLowerCase() === q
  );
  if (exactName) return exactName;

  // 3. Partial filename match
  const partial = all.find((f) =>
    path.basename(f, '.md').toLowerCase().includes(q)
  );
  if (partial) return partial;

  return null;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return {
    frontmatter: match[1].trim(),
    body: content.slice(match[0].length),
  };
}

module.exports = {
  name: 'obsidian-read',
  description:
    'Baca satu note dari vault Obsidian berdasarkan nama atau path. ' +
    'Contoh: "obsidian-read: Sentinel NMS" atau "note: Home".',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('note:') || t.startsWith('obsidian-read:');
  },

  async run(text) {
    const query = text.replace(/^(note:|obsidian-read:)\s*/i, '').trim();
    if (!query) {
      return 'Contoh: obsidian-read: Sentinel NMS';
    }

    const file = findNote(query);
    if (!file) {
      return `Note "${query}" tidak ditemukan di vault.`;
    }

    try {
      const raw = fs.readFileSync(file, 'utf-8');
      if (raw.length > 200000) {
        return `Note terlalu besar (${raw.length} char).`;
      }

      const { frontmatter, body } = parseFrontmatter(raw);
      const rel = path.relative(VAULT_DIR, file);

      const parts = [`📄 **${rel}**`];
      if (frontmatter) {
        parts.push('', '```yaml', frontmatter, '```');
      }
      parts.push('', body.slice(0, 3500));

      return parts.join('\n');
    } catch (e) {
      return `Gagal baca note: ${e.message}`;
    }
  },
};
