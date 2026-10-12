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
const {
  saveOrganizeBatch,
  loadBatch,
  formatBatchSummary,
} = require('../src/vault/batch');

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

  async run(text, ctx = {}) {
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
      const batch = saveOrganizeBatch({
        normalizations: plan.normalizations,
        moves: plan.moves,
        userId: ctx.userId || 'local',
      });
      return [
        '📋 **RENCANA PENATAAN VAULT (PLAN)**',
        `Batch id: \`${batch.id}\` _(berlaku ~30 menit)_`,
        '',
        formatBatchSummary(batch),
        '',
        '⚠️ Satu kali approval untuk **seluruh** batch.',
        'Jalankan apply:',
        `\`obsidian-organize: {"mode":"apply","batchId":"${batch.id}"}\``,
      ].join('\n');
    }

    if (mode === 'apply') {
      const batchId = String(input.batchId || input.batch || '').trim();
      if (!batchId) {
        return (
          'Apply membutuhkan batchId dari mode plan.\n' +
          '1) obsidian-organize: {"mode":"plan"}\n' +
          '2) obsidian-organize: {"mode":"apply","batchId":"batch_xxx"}'
        );
      }

      const batch = loadBatch(batchId);
      if (
        !batch ||
        batch.type !== 'obsidian-organize' ||
        batch.userId !==
          String(ctx.userId || 'local').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
      ) {
        return `Batch tidak ditemukan atau expired: \`${batchId}\`\nBuat ulang dengan mode plan.`;
      }

      const results = [];

      for (const rel of batch.normalizations) {
        const res = await normalizeSkill.run(`obsidian-normalize: ${rel}`);
        results.push(String(res));
      }

      for (const item of batch.moves) {
        const res = await moveSkill.run(`obsidian-move: ${JSON.stringify(item)}`);
        results.push(String(res));
      }

      return [
        '✅ **BATCH APPLY SELESAI**',
        `Batch: \`${batch.id}\``,
        `Tindakan: ${results.length}`,
        '',
        ...results.slice(0, 15),
        results.length > 15 ? `… +${results.length - 15} lainnya` : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    return 'Mode tidak dikenal. Gunakan mode: "audit", "plan", atau "apply".';
  },
};
