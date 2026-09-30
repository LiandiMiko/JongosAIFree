const path = require('path');
const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
} = require('../src/vault');

module.exports = {
  name: 'obsidian-backlinks',
  description:
    'Cari note yang me-link ke sebuah note (backlinks), sekaligus lihat outgoing link. ' +
    'Contoh: "obsidian-backlinks: Fundamental Networking"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-backlinks:') || t.startsWith('backlinks:');
  },

  async run(text) {
    const query = String(text || '')
      .replace(/^(obsidian-backlinks:|backlinks:)\s*/i, '')
      .trim();

    if (!query) {
      return 'Contoh: obsidian-backlinks: Fundamental Networking';
    }

    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const files = walkMarkdownFiles();
    if (!files.length) return 'Vault kosong.';

    const notes = files
      .map((f) => loadNote(f))
      .filter((n) => n && !n.sensitive);

    const byName = new Map(notes.map((n) => [n.nameLower, n]));

    const q = query.replace(/\.md$/i, '').toLowerCase();
    let target =
      byName.get(q) ||
      notes.find((n) => n.nameLower.includes(q)) ||
      notes.find((n) => n.path.toLowerCase().includes(q));

    if (!target) {
      return `Note "${query}" tidak ditemukan.`;
    }

    const targetName = target.nameLower;

    const outgoing = [];
    const seenOut = new Set();
    for (const linkName of target.links) {
      if (seenOut.has(linkName)) continue;
      seenOut.add(linkName);
      const resolved = byName.get(linkName) || null;
      outgoing.push({
        name: linkName,
        resolved: resolved ? resolved.path : null,
        broken: !resolved,
      });
    }

    const backlinks = [];
    for (const n of notes) {
      if (n.path === target.path) continue;
      if (n.links.includes(targetName)) {
        backlinks.push({ path: n.path });
      }
    }

    const lines = [
      `🔗 **${target.name}**`,
      '',
      `📁 \`${target.path}\``,
      '',
      `⬅️ **Backlinks** (${backlinks.length})`,
    ];

    if (!backlinks.length) {
      lines.push('   (tidak ada note yang link ke sini)');
    } else {
      for (const b of backlinks) {
        lines.push(`• \`${b.path}\``);
      }
    }

    lines.push('');
    lines.push(`➡️ **Outgoing links** (${outgoing.length})`);

    if (!outgoing.length) {
      lines.push('   (tidak ada link keluar)');
    } else {
      for (const o of outgoing) {
        if (o.broken) {
          lines.push(`• \`[[${o.name}]]\` ⚠️ _(broken)_`);
        } else {
          lines.push(`• \`[[${o.name}]]\` → \`${o.resolved}\``);
        }
      }
    }

    return lines.join('\n');
  },
};