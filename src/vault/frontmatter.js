/**
 * Pisahkan frontmatter YAML dan isi body note.
 * Tidak pakai library eksternal (supaya tetap ringan).
 */
function parseFrontmatter(content) {
  // Strip UTF-8 BOM yang sering muncul di file Windows
  let text = String(content || '');
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return {
      frontmatter: null,
      body: text,
      raw: null,
    };
  }

  return {
    frontmatter: match[1].trim(),
    body: text.slice(match[0].length),
    raw: match[1],
  };
}

/**
 * Bersihkan satu tag: strip quotes, strip leading #
 */
function cleanTag(t) {
  return String(t || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^#/, '')
    .trim();
}

/**
 * Ambil tags dari teks frontmatter.
 * Support:
 *   tags: [a, b]
 *   tags:
 *     - a
 *     - b
 *   tags: single-tag
 */
function extractTags(frontmatter) {
  if (!frontmatter) return [];

  const tags = [];
  const lines = String(frontmatter).split(/\r?\n/);
  let inBlock = false;

  for (const line of lines) {
    // tags: [a, b, c]
    const inline = line.match(/^tags\s*:\s*\[(.*)]\s*$/i);
    if (inline) {
      // Parse respecting quoted entries
      const raw = inline[1];
      // Split by comma outside quotes (simple heuristic)
      raw.split(',').forEach((t) => {
        const tag = cleanTag(t);
        if (tag) tags.push(tag);
      });
      inBlock = false;
      continue;
    }

    // tags: single-value
    const singleMatch = line.match(/^tags\s*:\s*(\S+.*)$/i);
    if (singleMatch) {
      const val = singleMatch[1].trim();
      if (!val.startsWith('-')) {
        const tag = cleanTag(val);
        if (tag) tags.push(tag);
        inBlock = false;
        continue;
      }
    }

    // tags: (block list start)
    if (/^tags\s*:\s*$/i.test(line)) {
      inBlock = true;
      continue;
    }

    if (inBlock) {
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) {
        const tag = cleanTag(item[1]);
        if (tag) tags.push(tag);
      } else if (line.trim() !== '') {
        inBlock = false;
      }
    }
  }

  return tags;
}

/**
 * Cek apakah note ditandai sensitive: true/yes
 */
function isSensitive(frontmatter) {
  if (!frontmatter) return false;
  return /^sensitive\s*:\s*(?:true|yes|"true"|'true')\b/im.test(String(frontmatter));
}

module.exports = {
  parseFrontmatter,
  extractTags,
  isSensitive,
};