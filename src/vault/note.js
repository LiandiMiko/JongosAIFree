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
    .trim();

  const lines = cleaned.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const para = lines.find((l) => l.length > 10) || lines.join(' ');
  return para.slice(0, maxLen).trim();
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
 * Simpan teks ke file note (atomic write: tmp → rename).
 * Membuat folder induk jika belum ada.
 */
function saveNote(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(tempPath, String(content ?? ''), 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file if rename fails
    try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Ubah path relatif vault → path absolut.
 * SECURITY: Mencegah path traversal (../../) keluar dari vault.
 */
function resolveNotePath(relativePath) {
  const vaultDir = path.resolve(getVaultDir());
  const cleaned = String(relativePath || '')
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/');

  const resolved = path.resolve(vaultDir, cleaned);
  const rel = path.relative(vaultDir, resolved);

  // Block path traversal outside vault
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `[SECURITY] Path traversal ditolak: "${relativePath}" berada di luar vault.`
    );
  }

  return resolved;
}

module.exports = {
  loadNote,
  saveNote,
  resolveNotePath,
  makeSnippet,
};