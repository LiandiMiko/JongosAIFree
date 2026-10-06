/**
 * Escape string untuk aman di YAML frontmatter (gunakan JSON.stringify).
 * @param {string} str
 * @returns {string} JSON-quoted string (e.g. "Meeting: Updates")
 */
function escapeYamlString(str) {
  const s = String(str || '').replace(/[\r\n]+/g, ' ').trim();
  return JSON.stringify(s);
}

/**
 * Buat isi note baru mengikuti standar format vault.
 * SECURITY: title dan tags di-escape agar tidak bisa inject YAML fields.
 */
function buildNewNote({ title, body = '', tags = [], sensitive = false }) {
  const safeTitle = String(title || 'Untitled').trim() || 'Untitled';
  const today = new Date().toISOString().slice(0, 10);
  const tagList = Array.isArray(tags) ? tags.filter(Boolean) : [];
  const tagsLine =
    tagList.length > 0
      ? `tags: [${tagList.map((t) => escapeYamlString(String(t).trim())).join(', ')}]`
      : 'tags: []';

  const contentBody = String(body || '').trim();

  return [
    '---',
    `title: ${escapeYamlString(safeTitle)}`,
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
 * Update field updated di frontmatter saja (bukan di body note).
 * Kalau tidak ada frontmatter, kembalikan content apa adanya.
 */
function touchUpdated(content) {
  let text = String(content || '');
  const today = new Date().toISOString().slice(0, 10);

  // Extract frontmatter boundary
  const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return text;

  let fm = fmMatch[1];

  if (/^updated\s*:/m.test(fm)) {
    // Replace ONLY inside frontmatter block
    fm = fm.replace(/^updated\s*:.*$/m, `updated: ${today}`);
  } else {
    fm = `updated: ${today}\n${fm}`;
  }

  return `---\n${fm}\n---\n${text.slice(fmMatch[0].length)}`;
}

module.exports = {
  buildNewNote,
  touchUpdated,
};