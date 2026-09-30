/**
 * Pisahkan frontmatter YAML dan isi body note.
 * Tidak pakai library eksternal (supaya tetap ringan).
 */
function parseFrontmatter(content) {
  const text = String(content || '');
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
 * Ambil tags dari teks frontmatter.
 * Support:
 *   tags: [a, b]
 *   tags:
 *     - a
 *     - b
 */
function extractTags(frontmatter) {
  if (!frontmatter) return [];

  const tags = [];
  const lines = String(frontmatter).split(/\r?\n/);
  let inBlock = false;

  for (const line of lines) {
    const inline = line.match(/^tags\s*:\s*\[(.*)\]\s*$/i);
    if (inline) {
      tags.push(
        ...inline[1]
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean)
      );
      inBlock = false;
      continue;
    }

    if (/^tags\s*:\s*$/i.test(line)) {
      inBlock = true;
      continue;
    }

    if (inBlock) {
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) {
        tags.push(item[1].replace(/^["']|["']$/g, '').trim());
      } else if (line.trim() !== '') {
        inBlock = false;
      }
    }
  }

  return tags;
}

/**
 * Cek apakah note ditandai sensitive: true
 */
function isSensitive(frontmatter) {
  if (!frontmatter) return false;
  return /^sensitive\s*:\s*true\s*$/im.test(String(frontmatter));
}

module.exports = {
  parseFrontmatter,
  extractTags,
  isSensitive,
};