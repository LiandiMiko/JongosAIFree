const path = require('path');
const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
} = require('../src/vault');

const MAX_RESULTS = 10;
const SNIPPET_LEN = 120;

function findSnippet(content, query) {
  const lower = String(content || '').toLowerCase();
  const q = String(query || '').toLowerCase();
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
  const q = String(query || '').toLowerCase();
  const lower = String(content || '').toLowerCase();

  let score = 0;

  if (name === q) score += 100;
  else if (name.includes(q)) score += 50;

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrences = (lower.match(new RegExp(escaped, 'g')) || []).length;
  score += Math.min(occurrences * 5, 40);

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
    const t = String(text || '').trim().toLowerCase();
    return (
      t.startsWith('search:') ||
      t.startsWith('cari:') ||
      t.startsWith('obsidian-search:')
    );
  },

  async run(text) {
    const query = String(text || '')
      .replace(/^(search:|cari:|obsidian-search:)\s*/i, '')
      .trim();

    if (!query) return 'Contoh: obsidian-search: sentinel';

    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}\nCek OBSIDIAN_VAULT di .env`;
    }

    const files = walkMarkdownFiles();
    if (!files.length) return 'Vault kosong atau tidak ada file .md.';

    const results = [];

    for (const file of files) {
      const note = loadNote(file);
      if (!note || note.sensitive) continue;

      const snippet = findSnippet(note.content, query);
      const score = scoreNote(file, note.content, query);

      if (snippet !== null || score > 0) {
        results.push({
          path: note.path,
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

    const lines = [
      `🔍 **Hasil cari: "${query}"** (${results.length} match)`,
      '',
    ];

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