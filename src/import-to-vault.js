/**
 * Import teks panjang / file ke vault Obsidian.
 */
const fs = require('fs');
const path = require('path');

try {
  require('dotenv').config();
} catch (_) {}

const {
  getVaultDir,
  vaultExists,
  resolveNotePath,
  saveNote,
  buildNewNote,
} = require('./vault');

const DEFAULT_FOLDER = 'Inbox/Imports';

function slugifyTitle(title) {
  return String(title || 'untitled')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'untitled';
}

function ensureMd(rel) {
  let r = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!r.toLowerCase().endsWith('.md')) r += '.md';
  return r;
}

function uniqueRelPath(rel) {
  const vaultDir = getVaultDir();
  let candidate = ensureMd(rel);
  let abs = resolveNotePath(candidate);
  if (!fs.existsSync(abs)) return candidate;

  const dir = path.posix.dirname(candidate.replace(/\\/g, '/'));
  const base = path.basename(candidate, '.md');
  for (let i = 2; i < 100; i++) {
    const next = dir === '.' ? `${base} (${i}).md` : `${dir}/${base} (${i}).md`;
    abs = resolveNotePath(next);
    if (!fs.existsSync(abs)) return next;
  }
  return ensureMd(
    dir === '.'
      ? `${base}-${Date.now()}.md`
      : `${dir}/${base}-${Date.now()}.md`
  );
}

function tryReindex() {
  try {
    const { indexVault } = require('./rag');
    indexVault();
  } catch (e) {
    console.log('[import-to-vault] reindex skip:', e.message);
  }
}

/**
 * Simpan teks sebagai note baru.
 * @returns {{ ok: boolean, rel?: string, abs?: string, error?: string }}
 */
function saveTextAsNote({ title, body, folder = DEFAULT_FOLDER, tags = [] } = {}) {
  if (!vaultExists()) {
    return { ok: false, error: `Vault tidak ditemukan.\nPath: ${getVaultDir()}` };
  }

  const cleanTitle = slugifyTitle(title || 'Catatan Telegram');
  const folderClean = String(folder || DEFAULT_FOLDER)
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const rel = uniqueRelPath(`${folderClean}/${cleanTitle}.md`);
  const abs = resolveNotePath(rel);

  const vaultDir = getVaultDir();
  if (!abs.startsWith(vaultDir)) {
    return { ok: false, error: 'Path di luar vault tidak diizinkan.' };
  }

  const tagList = Array.isArray(tags) ? tags : [];
  if (!tagList.includes('import')) tagList.push('import');
  if (!tagList.includes('telegram')) tagList.push('telegram');

  const content = buildNewNote({
    title: cleanTitle,
    body: String(body || '').trim() || '_(kosong)_',
    tags: tagList,
  });

  try {
    saveNote(abs, content);
    tryReindex();
    return { ok: true, rel, abs, title: cleanTitle };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Simpan isi file (.md / .txt) ke vault.
 * .json dibiarkan ke handler AI-chat import terpisah.
 */
function saveFileContentAsNote({
  originalName,
  content,
  folder = DEFAULT_FOLDER,
  caption = '',
} = {}) {
  const base = path.basename(originalName || 'import', path.extname(originalName || ''));
  let title = slugifyTitle(base);
  let body = String(content || '');

  // Caption bisa: "judul: Foo" atau path folder
  const cap = String(caption || '').trim();
  let targetFolder = folder;
  if (cap) {
    const mTitle = cap.match(/^(?:judul|title)\s*:\s*(.+)$/i);
    const mFolder = cap.match(/^(?:folder|ke|to)\s*:\s*(.+)$/i);
    if (mTitle) title = slugifyTitle(mTitle[1]);
    else if (mFolder) targetFolder = mFolder[1].trim();
    else if (cap.length < 80 && !cap.includes('\n')) title = slugifyTitle(cap);
    else body = `${cap}\n\n---\n\n${body}`;
  }

  // Jika file sudah markdown dengan frontmatter, simpan hampir apa adanya
  const trimmed = body.trim();
  if (trimmed.startsWith('---')) {
    if (!vaultExists()) {
      return { ok: false, error: `Vault tidak ditemukan.\nPath: ${getVaultDir()}` };
    }
    const rel = uniqueRelPath(`${targetFolder}/${title}.md`);
    const abs = resolveNotePath(rel);
    try {
      saveNote(abs, trimmed.endsWith('\n') ? trimmed : trimmed + '\n');
      tryReindex();
      return { ok: true, rel, abs, title };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return saveTextAsNote({
    title,
    body,
    folder: targetFolder,
    tags: ['import', 'telegram', 'file'],
  });
}

/**
 * Deteksi perintah simpan dari teks chat.
 * Format didukung:
 *   /save Judul
 *   isi note...
 *
 *   simpan note: Judul
 *   isi...
 *
 *   simpan:
 *   isi panjang...
 *
 *   #catat Judul
 *   isi...
 */
function parseSaveTextCommand(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // /save ...
  let m = raw.match(/^\/save(?:@\w+)?(?:\s+(.+))?$/is);
  if (m) {
    const rest = (m[1] || '').trim();
    if (!rest) {
      return { type: 'save', needsBody: true, title: null, body: '' };
    }
    const lines = rest.split(/\r?\n/);
    const title = lines[0].trim() || 'Catatan Telegram';
    const body = lines.slice(1).join('\n').trim();
    return { type: 'save', title, body, needsBody: !body };
  }

  // simpan note: / simpan catatan: / #catat
  m = raw.match(/^(?:simpan\s+(?:note|catatan|ke\s+vault)|#catat)\s*:?\s*(.*)$/is);
  if (m) {
    const rest = (m[1] || '').trim();
    if (!rest) return { type: 'save', needsBody: true, title: null, body: '' };
    const lines = rest.split(/\r?\n/);
    // Baris pertama = judul jika pendek; kalau satu blok panjang tanpa newline = body
    if (lines.length === 1 && lines[0].length > 80) {
      return {
        type: 'save',
        title: lines[0].slice(0, 60) + '…',
        body: lines[0],
        needsBody: false,
      };
    }
    const title = lines[0].trim() || 'Catatan Telegram';
    const body = lines.slice(1).join('\n').trim() || lines[0];
    return {
      type: 'save',
      title,
      body: lines.length > 1 ? lines.slice(1).join('\n').trim() : '',
      needsBody: lines.length === 1,
    };
  }

  // simpan:  (body only, auto title)
  m = raw.match(/^simpan\s*:\s*([\s\S]+)$/i);
  if (m) {
    const body = m[1].trim();
    if (!body) return null;
    const firstLine = body.split(/\r?\n/)[0].trim();
    const title =
      firstLine.length > 0 && firstLine.length <= 80
        ? firstLine
        : `Telegram ${new Date().toISOString().slice(0, 10)}`;
    return {
      type: 'save',
      title,
      body: firstLine === title && body.includes('\n') ? body.split(/\r?\n/).slice(1).join('\n').trim() || body : body,
      needsBody: false,
    };
  }

  return null;
}

/** Teks sangat panjang tanpa perintah — tawarkan? Kita auto-save hanya dengan perintah eksplisit. */
function isExplicitSaveCommand(text) {
  return !!parseSaveTextCommand(text);
}

module.exports = {
  DEFAULT_FOLDER,
  saveTextAsNote,
  saveFileContentAsNote,
  parseSaveTextCommand,
  isExplicitSaveCommand,
  slugifyTitle,
};
