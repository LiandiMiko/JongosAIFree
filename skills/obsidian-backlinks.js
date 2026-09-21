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

function normalizeLinkName(name) {
  return name
    .split('|')[0]           // strip alias
    .split('#')[0]           // strip section anchor
    .trim()
    .toLowerCase();
}

function extractLinks(content) {
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
  return matches.map((m) => {
    const inner = m.slice(2, -2);
    return {
      raw: inner,
      name: normalizeLinkName(inner),
      alias: inner.includes('|') ? inner.split('|')[1].trim() : null,
    };
  });
}

function buildNoteIndex(files) {
  // Maps: lowercase-note-name → relative path
  const index = new Map();
  for (const file of files) {
    const rel = path.relative(VAULT_DIR, file);
    const name = path.basename(file, '.md').toLowerCase();
    index.set(name, rel);
  }
  return index;
}

function findNoteByName(index, query) {
  const q = query.trim().replace(/\.md$/i, '').toLowerCase();
  if (!q) return null;

  // Exact match
  if (index.has(q)) return index.get(q);

  // Partial match
  for (const [name, rel] of index.entries()) {
    if (name.includes(q)) return rel;
  }
  return null;
}

module.exports = {
  name: 'obsidian-backlinks',
  description:
    'Cari note yang me-link ke sebuah note (backlinks), sekaligus lihat outgoing link dari note itu. ' +
    'Contoh: "obsidian-backlinks: Sentinel NMS".',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('obsidian-backlinks:') || t.startsWith('backlinks:');
  },

  async run(text) {
    const query = text.replace(/^(obsidian-backlinks:|backlinks:)\s*/i, '').trim();
    if (!query) {
      return 'Contoh: obsidian-backlinks: Sentinel NMS';
    }

    const files = walk(VAULT_DIR);
    if (!files.length) return 'Vault kosong.';

    const index = buildNoteIndex(files);
    const targetRel = findNoteByName(index, query);

    if (!targetRel) {
      return `Note "${query}" tidak ditemukan.`;
    }

    const targetName = path.basename(targetRel, '.md').toLowerCase();

    // 1. Outgoing links dari target
    let outgoing = [];
    try {
      const content = fs.readFileSync(path.join(VAULT_DIR, targetRel), 'utf-8');
      const links = extractLinks(content);
      const seen = new Set();
      for (const link of links) {
        if (seen.has(link.name)) continue;
        seen.add(link.name);
        const resolved = index.get(link.name) || null;
        outgoing.push({
          name: link.raw,
          resolved,
          broken: !resolved,
        });
      }
    } catch (e) {
      // skip
    }

    // 2. Backlinks — note lain yang link ke target
    const backlinks = [];
    for (const file of files) {
      const rel = path.relative(VAULT_DIR, file);
      if (rel === targetRel) continue;

      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch (e) {
        continue;
      }

      const links = extractLinks(content);
      const matching = links.filter((l) => l.name === targetName);

      if (matching.length) {
        backlinks.push({
          path: rel,
          count: matching.length,
          alias: matching.find((l) => l.alias)?.alias || null,
        });
      }
    }

    // 3. Format output
    const lines = [`🔗 **${path.basename(targetRel, '.md')}**`, ''];
    lines.push(`📁 \`${targetRel}\``);
    lines.push('');

    // Backlinks
    lines.push(`⬅️ **Backlinks** (${backlinks.length})`);
    if (backlinks.length === 0) {
      lines.push('   (tidak ada note yang link ke sini)');
    } else {
      for (const b of backlinks) {
        const aliasMark = b.alias ? ` _(alias: "${b.alias}")_` : '';
        lines.push(`• \`${b.path}\`${aliasMark}`);
      }
    }

    lines.push('');

    // Outgoing
    lines.push(`➡️ **Outgoing links** (${outgoing.length})`);
    if (outgoing.length === 0) {
      lines.push('   (tidak ada link keluar)');
    } else {
      for (const o of outgoing) {
        if (o.broken) {
          lines.push(`• \`[[${o.name}]]\` ⚠️ _(broken)_`);
        } else {
          lines.push(`• \`[[${o.name}]]\` → \`${o.resolved}\``);
        }
      }
    }

    return lines.join('\n');
  },
};
