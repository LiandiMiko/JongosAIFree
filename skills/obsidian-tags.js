const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
} = require('../src/vault');

function extractInlineTags(body) {
  const matches =
    String(body || '').match(/(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g) || [];
  return matches.map((m) => m.trim().slice(1));
}

function getAllTags() {
  const files = walkMarkdownFiles();
  const tagMap = new Map();

  for (const file of files) {
    const note = loadNote(file);
    if (!note || note.sensitive) continue;

    for (const t of note.tags) {
      const key = t.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key).push({
        path: note.path,
        source: 'frontmatter',
        raw: t,
      });
    }

    for (const t of extractInlineTags(note.body)) {
      const key = t.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key).push({
        path: note.path,
        source: 'inline',
        raw: t,
      });
    }
  }

  return tagMap;
}

module.exports = {
  name: 'obsidian-tags',
  description:
    'List semua tag di vault Obsidian, atau cari note berdasarkan tag. ' +
    'Contoh: "obsidian-tags" atau "obsidian-tags: network"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return (
      t === 'obsidian-tags' ||
      t.startsWith('obsidian-tags:') ||
      t.startsWith('tags:')
    );
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const stripped = String(text || '').trim().toLowerCase();
    const query =
      stripped === 'obsidian-tags' || stripped === 'tags'
        ? ''
        : String(text || '')
            .replace(/^(obsidian-tags:|tags:)\s*/i, '')
            .trim();

    const tagMap = getAllTags();

    if (!query) {
      if (tagMap.size === 0) return 'Tidak ada tag di vault.';

      const sorted = [...tagMap.entries()].sort(
        (a, b) => b[1].length - a[1].length
      );

      const lines = ['🏷️ **Semua tag di vault**', ''];
      for (const [tag, entries] of sorted) {
        const uniqueNotes = new Set(entries.map((e) => e.path));
        lines.push(`• \`#${tag}\` — ${uniqueNotes.size} note`);
      }
      lines.push('');
      lines.push(`Total: ${tagMap.size} tag unik`);
      return lines.join('\n');
    }

    const key = query.replace(/^#/, '').toLowerCase();
    const entries = tagMap.get(key);

    if (!entries || entries.length === 0) {
      return `Tidak ada note dengan tag "#${query}".`;
    }

    const lines = [`🏷️ **Note dengan tag #${key}** (${entries.length})`, ''];
    const seen = new Set();
    for (const e of entries) {
      if (seen.has(e.path)) continue;
      seen.add(e.path);
      const sourceMark = e.source === 'inline' ? ' _(inline)_' : '';
      lines.push(`• \`${e.path}\`${sourceMark}`);
    }

    return lines.join('\n');
  },
};