const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
} = require('../src/vault');

const RECENT_DAYS = 7;
const MAX_NOTES = 8;

function normalize(str) {
  return String(str || '')
    .replace(/[-_\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

function scoreName(note, q, qNorm) {
  if (note.nameLower === q) return 100;
  const nNorm = normalize(note.nameLower);
  if (nNorm === qNorm) return 80;
  if (nNorm.startsWith(qNorm + ' ') || nNorm === qNorm) return 60;
  if (nNorm.includes(qNorm)) return 40;
  return 0;
}

module.exports = {
  name: 'obsidian-context',
  description:
    'Ambil konteks lengkap tentang sebuah topik dari vault Obsidian: ' +
    'note utama, tag terkait, backlinks, outgoing links, dan note terbaru. ' +
    'Contoh: "obsidian-context: Network"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-context:') || t.startsWith('context:');
  },

  async run(text) {
    const query = String(text || '')
      .replace(/^(obsidian-context:|context:)\s*/i, '')
      .trim();

    if (!query) return 'Contoh: obsidian-context: Network';

    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const q = query.toLowerCase();
    const qNorm = normalize(q);

    const files = walkMarkdownFiles();
    if (!files.length) return 'Vault kosong.';

    const notes = files
      .map((f) => loadNote(f))
      .filter((n) => n && !n.sensitive);

    const index = new Map(notes.map((n) => [n.nameLower, n]));

    let mainNote = null;
    let bestScore = 0;
    for (const n of notes) {
      const score = scoreName(n, q, qNorm);
      if (score > bestScore) {
        bestScore = score;
        mainNote = n;
      }
    }
    if (bestScore === 0) mainNote = null;

    const tagMatches = notes.filter((n) =>
      n.tags.some((t) => t === q || t.includes(q))
    );

    const bodyMatches = notes.filter((n) => {
      if (mainNote && n.path === mainNote.path) return false;
      if (tagMatches.some((tm) => tm.path === n.path)) return false;
      return n.snippet.toLowerCase().includes(q);
    });

    const backlinks = mainNote
      ? notes.filter(
          (n) =>
            n.path !== mainNote.path &&
            n.links.includes(mainNote.nameLower)
        )
      : [];

    const outgoing = mainNote
      ? mainNote.links.map((linkName) => index.get(linkName)).filter(Boolean)
      : [];

    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const recent = notes
      .filter((n) => n.mtime >= cutoff)
      .sort((a, b) => b.mtime - a.mtime);

    const lines = [`🧠 **Konteks: "${query}"**`, ''];

    if (mainNote) {
      lines.push(`📌 **Note utama:** \`${mainNote.path}\``);
      if (mainNote.tags.length) {
        lines.push(`   Tag: ${mainNote.tags.map((t) => '#' + t).join(' ')}`);
      }
      if (mainNote.snippet) {
        lines.push(`   ${mainNote.snippet.slice(0, 160)}`);
      }
      lines.push('');
    }

    if (tagMatches.length) {
      lines.push(`🏷️ **Note dengan tag terkait** (${tagMatches.length})`);
      for (const n of tagMatches.slice(0, MAX_NOTES)) {
        const isMain = mainNote && n.path === mainNote.path;
        lines.push(`• \`${n.path}\`${isMain ? ' _(utama)_' : ''}`);
      }
      lines.push('');
    }

    if (backlinks.length) {
      lines.push(`⬅️ **Backlinks** (${backlinks.length})`);
      for (const n of backlinks.slice(0, MAX_NOTES)) {
        lines.push(`• \`${n.path}\``);
      }
      lines.push('');
    }

    if (outgoing.length) {
      lines.push(`➡️ **Outgoing** (${outgoing.length})`);
      for (const n of outgoing.slice(0, MAX_NOTES)) {
        lines.push(`• \`${n.path}\``);
      }
      lines.push('');
    }

    if (bodyMatches.length) {
      lines.push(`📄 **Note dengan keyword di body** (${bodyMatches.length})`);
      for (const n of bodyMatches.slice(0, MAX_NOTES)) {
        lines.push(`• \`${n.path}\` — ${n.snippet.slice(0, 100)}`);
      }
      lines.push('');
    }

    if (recent.length) {
      lines.push(
        `🕐 **Note di-update ${RECENT_DAYS} hari terakhir** (${recent.length})`
      );
      for (const n of recent.slice(0, 5)) {
        const daysAgo = Math.round(
          (Date.now() - n.mtime) / (24 * 60 * 60 * 1000)
        );
        lines.push(`• \`${n.path}\` — ${daysAgo}d lalu`);
      }
      lines.push('');
    }

    const totalFound =
      (mainNote ? 1 : 0) +
      tagMatches.length +
      backlinks.length +
      outgoing.length +
      bodyMatches.length;

    if (totalFound === 0) {
      return `Tidak ada konteks yang cocok dengan "${query}".`;
    }

    lines.push(
      '💡 Konteks di atas sudah cukup untuk menjawab. ' +
        'Kalau butuh detail, baca 1 note paling relevan saja.'
    );

    return lines.join('\n').trim();
  },
};