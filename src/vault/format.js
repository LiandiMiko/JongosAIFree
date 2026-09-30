/**
 * Buat isi note baru mengikuti standar format vault.
 */
function buildNewNote({ title, body = '', tags = [], sensitive = false }) {
  const safeTitle = String(title || 'Untitled').trim() || 'Untitled';
  const today = new Date().toISOString().slice(0, 10);
  const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const tagsLine =
    tagList.length > 0
      ? `tags: [${tagList.map((t) => String(t).trim()).join(', ')}]`
      : 'tags: []';

  const contentBody = String(body || '').trim();

  return [
    '---',
    `title: ${safeTitle}`,
    tagsLine,
    `created: ${today}`,
    `updated: ${today}`,
    'status: active',
    `sensitive: ${sensitive ? 'true' : 'false'}`,
    '---',
    '',
    `# ${safeTitle}`,
    '',
    '## Ringkasan',
    '',
    contentBody || '...',
    '',
    '## Detail',
    '',
    '...',
    '',
    '## Link terkait',
    '',
    '- ',
    '',
  ].join('\n');
}

/**
 * Update field updated di frontmatter (kalau ada).
 * Kalau tidak ada frontmatter, kembalikan content apa adanya.
 */
function touchUpdated(content) {
  const text = String(content || '');
  const today = new Date().toISOString().slice(0, 10);

  if (!text.startsWith('---')) return text;

  if (/^updated\s*:/m.test(text)) {
    return text.replace(/^updated\s*:.*$/m, `updated: ${today}`);
  }

  // sisipkan updated setelah baris --- pembuka, sebelum --- penutup
  return text.replace(/^---\r?\n/, `---\nupdated: ${today}\n`);
}

module.exports = {
  buildNewNote,
  touchUpdated,
};