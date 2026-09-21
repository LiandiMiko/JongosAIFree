const fs = require('fs');
const path = require('path');

const VAULT_DIR =
  process.env.OBSIDIAN_VAULT ||
  path.join(__dirname, '..', 'memory', 'second-brain');

const MAX_RESULTS = 10;
const SNIPPET_LEN = 120;

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

function findSnippet(content, query) {
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx === -1) return null;

  const start = Math.max(0, idx - 40);
  const end = Math.min(content.length, idx + q.length + SNIPPET_LEN);
  let snippet = content.slice(start, end).replace(/\n+/g, ' ').trim();

  if (start > 0) snippet = '…' + snippet;
  if (end < content.length) snippet = snippet + '…';
  return snippet;
}

function scoreNote(filePath, content, query) {
  const name = path.basename(filePath, '.md').toLowerCase();
  const q = query.toLowerCase();
  const lower = content.toLowerCase();

  let score = 0;

  // Title exact match
  if (name === q) score += 100;
  // Title contains
  else if (name.includes(q)) score += 50;

  // Content occurrences
  const occurrences = (lower.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  score += Math.min(occurrences * 5, 40);

  // Bonus if in first 200 chars (opening)
  if (lower.slice(0, 200).includes(q)) score += 15;

  return score;
}

module.exports = {
  name: 'obsidian-search',
  description:
    'Cari kata kunci di seluruh vault Obsidian. ' +
    'Return daftar note yang cocok + snippet. ' +
    'Contoh: "obsidian-search: sentinel" atau "cari: project".',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('search:') || t.startsWith('cari:') || t.startsWith('obsidian-search:');
  },

  async run(text) {
    const query = text.replace(/^(search:|cari:|obsidian-search:)\s*/i, '').trim();
    if (!query) return 'Contoh: obsidian-search: sentinel';

    const files = walk(VAULT_DIR);
    if (!files.length) return 'Vault kosong atau tidak ditemukan.';

    const results = [];

    for (const file of files) {
      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch (e) {
        continue;
      }

      const snippet = findSnippet(content, query);
      const score = scoreNote(file, content, query);

      if (snippet !== null || score > 0) {
        results.push({
          path: path.relative(VAULT_DIR, file),
          score,
          snippet: snippet || '(match di judul)',
        });
      }
    }

    if (!results.length) {
      return `Tidak ada note yang cocok dengan "${query}".`;
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, MAX_RESULTS);

    const lines = [`🔍 **Hasil cari: "${query}"** (${results.length} match)`, ''];

    for (const r of top) {
      lines.push(`📄 **${r.path}** (score: ${r.score})`);
      lines.push(`   ${r.snippet}`);
      lines.push('');
    }

    if (results.length > MAX_RESULTS) {
      lines.push(`_(+${results.length - MAX_RESULTS} lainnya disembunyikan)_`);
    }

    return lines.join('\n');
  },
};
