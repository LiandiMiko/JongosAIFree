const { parseFrontmatter, isSensitive } = require('../vault');

function chunkMarkdownNote(notePath, rawContent) {
  const { frontmatter, body } = parseFrontmatter(rawContent);

  // Skip sensitive notes
  if (isSensitive(frontmatter)) {
    return [];
  }

  // Extract title from frontmatter or filename
  let noteTitle = notePath;
  if (frontmatter) {
    const titleMatch = frontmatter.match(/^title\s*:\s*(.+)$/m);
    if (titleMatch) {
      noteTitle = titleMatch[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  const lines = body.split(/\r?\n/);
  const chunks = [];
  let currentHeader = 'General';
  let currentLines = [];

  function pushChunk() {
    const text = currentLines.join('\n').trim();
    if (text.length > 20) {
      chunks.push({
        id: `${notePath}#${chunks.length + 1}`,
        notePath,
        title: noteTitle,
        section: currentHeader,
        content: text,
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (headerMatch) {
      if (currentLines.length > 0) {
        pushChunk();
      }
      currentHeader = headerMatch[1].trim();
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    pushChunk();
  }

  return chunks;
}

module.exports = {
  chunkMarkdownNote,
};
