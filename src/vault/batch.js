const fs = require('fs');
const path = require('path');

const BATCH_DIR = path.join(__dirname, '..', '..', 'data', 'batches');
const TTL_MS = 30 * 60 * 1000;

function ensureDir() {
  fs.mkdirSync(BATCH_DIR, { recursive: true });
}

function makeId() {
  return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function batchPath(id) {
  if (!/^batch_[a-z0-9]+_[a-z0-9]+$/i.test(String(id || ''))) return null;
  return path.join(BATCH_DIR, `${id}.json`);
}

function safeUserId(userId) {
  return String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

/**
 * Simpan rencana batch organize.
 * @param {object} payload
 * @param {string[]} payload.normalizations - relative paths
 * @param {{from:string,to:string}[]} payload.moves
 * @param {string} [payload.userId]
 */
function saveOrganizeBatch(payload = {}) {
  ensureDir();
  const now = Date.now();
  const batch = {
    id: makeId(),
    type: 'obsidian-organize',
    createdAt: now,
    expiresAt: now + TTL_MS,
    userId: payload.userId ? safeUserId(payload.userId) : null,
    normalizations: Array.isArray(payload.normalizations)
      ? payload.normalizations.map(String)
      : [],
    moves: Array.isArray(payload.moves) ? payload.moves : [],
  };
  fs.writeFileSync(batchPath(batch.id), JSON.stringify(batch, null, 2), 'utf-8');
  return batch;
}

function loadBatch(id) {
  if (!id) return null;
  const file = batchPath(id);
  if (!file || !fs.existsSync(file)) return null;
  try {
    const batch = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!batch || !Number.isFinite(batch.expiresAt) || Date.now() > batch.expiresAt) {
      fs.unlinkSync(file);
      return null;
    }
    return batch;
  } catch {
    return null;
  }
}

function formatBatchSummary(batch, { maxLines = 15 } = {}) {
  if (!batch) return '(batch kosong)';
  const normalizations = Array.isArray(batch.normalizations) ? batch.normalizations : [];
  const moves = Array.isArray(batch.moves) ? batch.moves : [];
  const lines = [
    `Batch: \`${batch.id}\``,
    `Normalize: ${normalizations.length} file`,
    `Move: ${moves.length} file`,
    '',
  ];

  let shown = 0;
  for (const rel of normalizations) {
    if (shown >= maxLines) break;
    lines.push(`• normalize \`${rel}\``);
    shown++;
  }
  for (const move of moves) {
    if (shown >= maxLines) break;
    lines.push(`• move \`${move.from}\` → \`${move.to}\``);
    shown++;
  }
  const total = normalizations.length + moves.length;
  if (total > maxLines) {
    lines.push(`… +${total - maxLines} tindakan lain`);
  }
  return lines.join('\n');
}

module.exports = {
  saveOrganizeBatch,
  loadBatch,
  formatBatchSummary,
};
