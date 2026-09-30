const fs = require('fs');
const path = require('path');
const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  loadNote,
  saveNote,
  parseFrontmatter,
  extractTags,
  isSensitive,
  touchUpdated,
} = require('../src/vault');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-normalize:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw);
      return String(obj.path || obj.note || '').trim();
    } catch {
      // fallthrough
    }
  }

  return raw;
}

function normalizeNoteContent(content, noteName) {
  const today = new Date().toISOString().slice(0, 10);
  const { frontmatter, body } = parseFrontmatter(content);

  // Extract title: from frontmatter title, or first H1 header, or filename
  let title = noteName.replace(/\.md$/i, '');
  if (frontmatter) {
    const titleMatch = frontmatter.match(/^title\s*:\s*(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  } else {
    const h1Match = body.match(/^#\s+(.+)$/m);
    if (h1Match) {
      title = h1Match[1].trim();
    }
  }

  // Extract tags
  const tags = frontmatter ? extractTags(frontmatter) : [];
  const tagsLine =
    tags.length > 0
      ? `tags: [${tags.map((t) => String(t).trim()).join(', ')}]`
      : 'tags: []';

  // Extract or preserve created date
  let created = today;
  if (frontmatter) {
    const createdMatch = frontmatter.match(/^created\s*:\s*(.+)$/m);
    if (createdMatch) {
      created = createdMatch[1].trim();
    }
  }

  // Build standardized frontmatter
  const newFrontmatter = [
    '---',
    `title: ${title}`,
    tagsLine,
    `created: ${created}`,
    `updated: ${today}`,
    'status: active',
    'sensitive: false',
    '---',
  ].join('\n');

  // Prepare body: ensure H1 heading exists if missing
  let cleanBody = body.trim();
  if (!/^#\s+/m.test(cleanBody)) {
    cleanBody = `# ${title}\n\n${cleanBody}`;
  }

  return `${newFrontmatter}\n\n${cleanBody}\n`;
}

module.exports = {
  name: 'obsidian-normalize',
  description:
    'Rapikan format 1 note Obsidian sesuai standar vault (frontmatter + struktur). ' +
    'Contoh: obsidian-normalize: Inbox/Draft.md',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-normalize:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    let rel = parseInput(text);
    if (!rel) {
      return 'Path note wajib diisi. Contoh: obsidian-normalize: Inbox/Draft.md';
    }

    rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel.toLowerCase().endsWith('.md')) {
      rel += '.md';
    }

    const abs = resolveNotePath(rel);
    const vaultDir = getVaultDir();

    if (!abs.startsWith(vaultDir)) {
      return 'Path di luar vault tidak diizinkan.';
    }

    if (!fs.existsSync(abs)) {
      return `Note tidak ditemukan: \`${rel}\``;
    }

    const note = loadNote(abs);
    if (note?.sensitive) {
      return `Note \`${rel}\` ditandai sensitive dan tidak boleh dirapikan otomatis.`;
    }

    const filename = path.basename(abs);
    const normalized = normalizeNoteContent(note.content, filename);

    saveNote(abs, normalized);

    return `✨ Note berhasil dirapikan ke format standar: \`${rel}\``;
  },
};
