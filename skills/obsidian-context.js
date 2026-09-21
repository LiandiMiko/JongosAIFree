const fs = require('fs');
const path = require('path');

const VAULT_DIR =
  process.env.OBSIDIAN_VAULT ||
  path.join(__dirname, '..', 'memory', 'second-brain');

const RECENT_DAYS = 7;
const MAX_NOTES = 8;
const SNIPPET_LEN = 200;

function walk(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results);
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: null, body: content };
  return {
    frontmatter: match[1].trim(),
    body: content.slice(match[0].length),
  };
}

function extractFrontmatterTags(frontmatter) {
  if (!frontmatter) return [];
  const tags = [];
  const lines = frontmatter.split('\n');
  let inBlock = false;
  for (const line of lines) {
    const inline = line.match(/^tags\s*:\s*\[(.*)\]\s*$/i);
    if (inline) {
      tags.push(...inline[1].split(',').map((t) => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean));
      inBlock = false;
      continue;
    }
    if (/^tags\s*:\s*$/i.test(line)) { inBlock = true; continue; }
    if (inBlock) {
      const item = line.match(/^\s+-\s+(.+?)\s*$/);
      if (item) tags.push(item[1].replace(/^["']|["']$/g, '').trim());
      else if (line.trim() !== '') inBlock = false;
    }
  }
  return tags;
}

function extractLinks(content) {
  const matches = content.match(/\[\[([^\]]+)\]\]/g) || [];
  return matches.map((m) => m.slice(2, -2).split('|')[0].split('#')[0].trim().toLowerCase());
}

function makeSnippet(body, maxLen = SNIPPET_LEN) {
  // Skip frontmatter-like header, take first non-empty paragraph
  const cleaned = body
    .replace(/^#.*$/gm, '')            // strip headings
    .replace(/^---.*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  const firstPara = cleaned.split('\n').find((l) => l.trim().length > 10) || '';
  return firstPara.slice(0, maxLen).trim();
}

function loadNote(file) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    return null;
  }
  const stat = fs.statSync(file);
  const { frontmatter, body } = parseFrontmatter(content);
  const rel = path.relative(VAULT_DIR, file);
  const name = path.basename(file, '.md');
  return {
    path: rel,
    name,
    nameLower: name.toLowerCase(),
    frontmatter,
    tags: extractFrontmatterTags(frontmatter).map((t) => t.toLowerCase()),
    links: [...new Set(extractLinks(body))],
    snippet: makeSnippet(body),
    mtime: stat.mtimeMs,
  };
}

module.exports = {
  name: 'obsidian-context',
  description:
    'Ambil konteks lengkap tentang sebuah topik dari vault Obsidian: note utama, tag terkait, backlinks, outgoing links, dan note terbaru. ' +
    'Contoh: "obsidian-context: Sentinel" atau "context: infra".',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('obsidian-context:') || t.startsWith('context:');
  },

  async run(text) {
    const query = text.replace(/^(obsidian-context:|context:)\s*/i, '').trim();
    if (!query) return 'Contoh: obsidian-context: Sentinel';

    const q = query.toLowerCase();
    const files = walk(VAULT_DIR);
    if (!files.length) return 'Vault kosong.';

    const notes = files.map(loadNote).filter(Boolean);
    const index = new Map(notes.map((n) => [n.nameLower, n]));

    // 1. Main note — scoring: prefer exact, then normalized, then startsWith, then includes
    function normalize(str) {
      return str.replace(/[-_\s]+/g, ' ').trim();
    }
    const qNorm = normalize(q);

    function scoreName(n) {
      if (n.nameLower === q) return 100;
      const nNorm = normalize(n.nameLower);
      if (nNorm === qNorm) return 80;
      if (nNorm.startsWith(qNorm + ' ') || nNorm === qNorm) return 60;
      if (nNorm.includes(qNorm)) return 40;
      return 0;
    }

    let mainNote = null;
    let bestScore = 0;
    for (const n of notes) {
      const score = scoreName(n);
      if (score > bestScore) {
        bestScore = score;
        mainNote = n;
      }
    }
    if (!mainNote) mainNote = null;

    // 2. Notes with matching tag
    const tagMatches = notes.filter((n) =>
      n.tags.some((t) => t === q || t.includes(q))
    );

    // 3. Notes with keyword in body (fallback kalau nggak ada main note / tag)
    const bodyMatches = notes.filter((n) => {
      if (mainNote && n.path === mainNote.path) return false;
      if (tagMatches.some((tm) => tm.path === n.path)) return false;
      return n.snippet.toLowerCase().includes(q);
    });

    // 4. Backlinks ke main note (kalau ada)
    const backlinks = mainNote
      ? notes.filter((n) =>
          n.path !== mainNote.path && n.links.includes(mainNote.nameLower)
        )
      : [];

    // 5. Outgoing dari main note
    const outgoing = mainNote
      ? mainNote.links
          .map((linkName) => index.get(linkName))
          .filter(Boolean)
      : [];

    // 6. Recent notes (N hari terakhir)
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    const recent = notes
      .filter((n) => n.mtime >= cutoff)
      .sort((a, b) => b.mtime - a.mtime);

    // === Format ===
    const lines = [`🧠 **Konteks: "${query}"**`, ''];

    if (mainNote) {
      lines.push(`📌 **Note utama:** \`${mainNote.path}\``);
      if (mainNote.tags.length) lines.push(`   Tag: ${mainNote.tags.map((t) => '#' + t).join(' ')}`);
      if (mainNote.snippet) lines.push(`   ${mainNote.snippet.slice(0, 160)}`);
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
      lines.push(`🕐 **Note di-update ${RECENT_DAYS} hari terakhir** (${recent.length})`);
      for (const n of recent.slice(0, 5)) {
        const daysAgo = Math.round((Date.now() - n.mtime) / (24 * 60 * 60 * 1000));
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

    lines.push('');
    lines.push('💡 Konteks di atas sudah cukup untuk menjawab. Jangan panggil obsidian-read berulang kali — kalau butuh detail, baca 1 note paling relevan saja.');

    return lines.join('\n').trim();
  },
};
