const fs = require('fs');
const path = require('path');
const { getVaultDir } = require('./paths');
const { parseFrontmatter, extractTags, isSensitive } = require('./frontmatter');
const { extractLinks } = require('./links');

/**
 * Potong cuplikan isi note (tanpa heading kasar).
 */
function makeSnippet(body, maxLen = 200) {
  const cleaned = String(body || '')
    .replace(/^#.*$/gm, '')
    .replace(/^---.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();

  const firstPara =
    cleaned.split('\n').find((line) => line.trim().length > 10) || cleaned;

  return firstPara.slice(0, maxLen).trim();
}

/**
 * Baca satu file .md menjadi object note.
 * @param {string} filePath - path absolut ke file
 * @returns {object|null}
 */
function loadNote(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const vaultDir = getVaultDir();
  const { frontmatter, body } = parseFrontmatter(content);
  const rel = path.relative(vaultDir, filePath);
  const name = path.basename(filePath, '.md');

  return {
    path: rel.replace(/\\/g, '/'),
    absolutePath: filePath,
    name,
    nameLower: name.toLowerCase(),
    content,
    frontmatter,
    body,
    tags: extractTags(frontmatter).map((t) => t.toLowerCase()),
    links: extractLinks(body),
    snippet: makeSnippet(body),
    sensitive: isSensitive(frontmatter),
    mtime: stat.mtimeMs,
  };
}

/**
 * Simpan teks ke file note (overwrite).
 * Membuat folder induk jika belum ada.
 */
function saveNote(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, String(content ?? ''), 'utf-8');
}

/**
 * Ubah path relatif vault → path absolut.
 */
function resolveNotePath(relativePath) {
  const vaultDir = getVaultDir();
  const cleaned = String(relativePath || '')
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');

  return path.resolve(vaultDir, cleaned);
}

module.exports = {
  loadNote,
  saveNote,
  resolveNotePath,
  makeSnippet,
};