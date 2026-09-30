const fs = require('fs');
const path = require('path');
const {
  getVaultDir,
  vaultExists,
  walkMarkdownFiles,
  loadNote,
  parseFrontmatter,
  extractLinks,
  resolveNotePath,
} = require('../src/vault');

const moveSkill = require('./obsidian-move');
const normalizeSkill = require('./obsidian-normalize');

function parseInput(text) {
  const raw = String(text || '')
    .replace(/^obsidian-organize:\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    try {
      return JSON.parse(raw);
    } catch {
      // fallthrough
    }
  }

  // Fallback: simple text mode string
  if (raw) {
    return { mode: raw.toLowerCase() };
  }

  return { mode: 'audit' };
}

/**
 * Scan vault for issues:
 * - Notes without frontmatter
 * - Broken [[wikilinks]]
 * - Notes in root directory (unorganized)
 */
function auditVault() {
  const files = walkMarkdownFiles();
  const vaultDir = getVaultDir();

  const missingFrontmatter = [];
  const rootFiles = [];
  const brokenLinks = [];
  const titlesSeen = new Map();
  const duplicates = [];

  const fileSet = new Set(
    files.map((f) => path.relative(vaultDir, f).replace(/\\/g, '/').toLowerCase())
  );

  for (const abs of files) {
    const rel = path.relative(vaultDir, abs).replace(/\\/g, '/');
    const note = loadNote(abs);
    if (!note) continue;

    const { frontmatter } = parseFrontmatter(note.content);
    if (!frontmatter && !note.sensitive) {
      missingFrontmatter.push(rel);
    }

    if (!rel.includes('/')) {
      rootFiles.push(rel);
    }

    const titleLower = path.basename(rel, '.md').toLowerCase();
    if (titlesSeen.has(titleLower)) {
      duplicates.push({ original: titlesSeen.get(titleLower), duplicate: rel });
    } else {
      titlesSeen.set(titleLower, rel);
    }

    const links = extractLinks(note.content);
    for (const link of links) {
      let targetRel = link.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!targetRel.toLowerCase().endsWith('.md')) targetRel += '.md';
      if (!fileSet.has(targetRel.toLowerCase())) {
        brokenLinks.push({ source: rel, target: link });
      }
    }
  }

  return {
    totalFiles: files.length,
    missingFrontmatter,
    rootFiles,
    duplicates,
    brokenLinks,
  };
}

function generatePlan(audit) {
  const moves = [];
  const normalizations = audit.missingFrontmatter;

  for (const file of audit.rootFiles) {
    if (file.toLowerCase() === 'readme.md') continue;
    moves.push({
      from: file,
      to: `Inbox/${file}`,
    });
  }

  return {
    moves,
    normalizations,
  };
}

module.exports = {
  name: 'obsidian-organize',
  description:
    'Audit, buat rencana (plan), atau terapkan (apply) penataan vault Obsidian. ' +
    'Mode: audit (default), plan, apply. WAJIB approval untuk mode apply. ' +
    'Contoh: obsidian-organize: {"mode":"audit"}',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return t.startsWith('obsidian-organize:');
  },

  async run(text) {
    if (!vaultExists()) {
      return `Vault tidak ditemukan.\nPath: ${getVaultDir()}`;
    }

    const input = parseInput(text);
    const mode = (input.mode || 'audit').toLowerCase();

    if (mode === 'audit') {
      const audit = auditVault();
      return [
        '📊 **HASIL AUDIT VAULT OBSIDIAN**',
        `- Total File: ${audit.totalFiles}`,
        `- File Tanpa Frontmatter: ${audit.missingFrontmatter.length} (${audit.missingFrontmatter.slice(0, 5).join(', ')}${audit.missingFrontmatter.length > 5 ? '...' : ''})`,
        `- File di Root (Belum Terorganisir): ${audit.rootFiles.length} (${audit.rootFiles.slice(0, 5).join(', ')}${audit.rootFiles.length > 5 ? '...' : ''})`,
        `- Potensi Duplikat: ${audit.duplicates.length}`,
        `- Broken Links: ${audit.brokenLinks.length}`,
        '',
        '💡 Ketik `obsidian-organize: {"mode":"plan"}` untuk melihat rekomendasi tindakan.',
      ].join('\n');
    }

    if (mode === 'plan') {
      const audit = auditVault();
      const plan = generatePlan(audit);
      return [
        '📋 **RENCANA PENATAAN VAULT (PLAN)**',
        `1. Normalisasi Frontmatter (${plan.normalizations.length} file):`,
        ...plan.normalizations.slice(0, 5).map((f) => `   - Rapikan format: \`${f}\``),
        plan.normalizations.length > 5 ? `   ...dan ${plan.normalizations.length - 5} lainnya.` : '',
        '',
        `2. Pindahkan File Root ke Folder (Inbox/) (${plan.moves.length} file):`,
        ...plan.moves.slice(0, 5).map((m) => `   - \`${m.from}\` ➔ \`${m.to}\``),
        plan.moves.length > 5 ? `   ...dan ${plan.moves.length - 5} lainnya.` : '',
        '',
        '⚠️ Jalankan `obsidian-organize: {"mode":"apply"}` untuk mengeksekusi rencana ini (membutuhkan approval).',
      ].join('\n');
    }

    if (mode === 'apply') {
      const audit = auditVault();
      const plan = generatePlan(audit);
      const results = [];

      // 1. Normalize
      for (const rel of plan.normalizations) {
        const res = await normalizeSkill.run(`obsidian-normalize: ${rel}`);
        results.push(res);
      }

      // 2. Move root files to Inbox
      for (const item of plan.moves) {
        const res = await moveSkill.run(`obsidian-move: ${JSON.stringify(item)}`);
        results.push(res);
      }

      return [
        '✅ **EKSEKUSI BATCH PENATAAN VAULT SELESAI**',
        `Diolah: ${results.length} tindakan.`,
        ...results.slice(0, 10),
        results.length > 10 ? `...dan ${results.length - 10} tindakan lainnya.` : '',
      ].join('\n');
    }

    return 'Mode tidak dikenal. Gunakan mode: "audit", "plan", atau "apply".';
  },
};
