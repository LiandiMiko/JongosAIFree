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

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return {
    frontmatter: match[1].trim(),
    body: content.slice(match[0].length),
  };
}

function extractFrontmatterTags(frontmatter) {
  if (!frontmatter) return [];

  const tags = [];
  const lines = frontmatter.split('\n');
  let inTagsBlock = false;
  let blockIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inline array: tags: [a, b, c]
    const inline = line.match(/^tags\s*:\s*\[(.*)\]\s*$/i);
    if (inline) {
      const items = inline[1]
        .split(',')
        .map((t) => t.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
      tags.push(...items);
      inTagsBlock = false;
      continue;
    }

    // Block start: tags:
    const blockStart = line.match(/^tags\s*:\s*$/i);
    if (blockStart) {
      inTagsBlock = true;
      blockIndent = 0;
      continue;
    }

    if (inTagsBlock) {
      const item = line.match(/^(\s+)-\s+(.+?)\s*$/);
      if (item) {
        blockIndent = item[1].length;
        const tag = item[2].replace(/^["']|["']$/g, '').trim();
        if (tag) tags.push(tag);
      } else if (line.trim() === '') {
        // blank line inside block — keep going
        continue;
      } else {
        // new key at same or lower indent → tags block ends
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1].length : 0;
        if (indent <= blockIndent && blockIndent > 0) {
          inTagsBlock = false;
        }
      }
    }
  }

  return tags;
}

function extractInlineTags(body) {
  // #tag or #nested/tag — exclude headers (# followed by space)
  const matches = body.match(/(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)/g) || [];
  return matches.map((m) => m.trim().slice(1));
}

function getAllTags() {
  const files = walk(VAULT_DIR);
  const tagMap = new Map(); // tag → [{path, source}]

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch (e) {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter(content);
    const rel = path.relative(VAULT_DIR, file);

    const fmTags = extractFrontmatterTags(frontmatter);
    for (const t of fmTags) {
      const key = t.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key).push({ path: rel, source: 'frontmatter', raw: t });
    }

    const inlineTags = extractInlineTags(body);
    for (const t of inlineTags) {
      const key = t.toLowerCase();
      if (!tagMap.has(key)) tagMap.set(key, []);
      tagMap.get(key).push({ path: rel, source: 'inline', raw: t });
    }
  }

  return tagMap;
}

module.exports = {
  name: 'obsidian-tags',
  description:
    'List semua tag di vault Obsidian, atau cari note berdasarkan tag. ' +
    'Contoh: "obsidian-tags" (semua tag) atau "obsidian-tags: infra" (note dengan tag infra).',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t === 'obsidian-tags' || t.startsWith('obsidian-tags:') || t.startsWith('tags:');
  },

  async run(text) {
    const stripped = text.trim().toLowerCase();
    const query =
      stripped === 'obsidian-tags' || stripped === 'tags'
        ? ''
        : text.replace(/^(obsidian-tags:|tags:)\s*/i, '').trim();

    const tagMap = getAllTags();

    // Mode 1: no query → list all tags
    if (!query) {
      if (tagMap.size === 0) {
        return 'Tidak ada tag di vault.';
      }

      const sorted = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length);

      const lines = ['🏷️ **Semua tag di vault**', ''];
      for (const [tag, entries] of sorted) {
        lines.push(`• \`#${tag}\` — ${entries.length} note`);
      }
      lines.push('');
      lines.push(`Total: ${tagMap.size} tag unik`);

      return lines.join('\n');
    }

    // Mode 2: query → notes with that tag
    const key = query.replace(/^#/, '').toLowerCase();
    const entries = tagMap.get(key);

    if (!entries || entries.length === 0) {
      return `Tidak ada note dengan tag "#${query}".`;
    }

    const lines = [`🏷️ **Note dengan tag #${key}** (${entries.length})`, ''];
    const seen = new Set();
    for (const e of entries) {
      const dedupKey = e.path;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      const sourceMark = e.source === 'inline' ? ' _(inline)_' : '';
      lines.push(`• \`${e.path}\`${sourceMark}`);
    }

    return lines.join('\n');
  },
};
