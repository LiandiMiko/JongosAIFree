/**
 * Plan object untuk agent multi-step.
 * Belum mengeksekusi tool — hanya data + helper.
 */

const MAX_STEPS = 8;

/**
 * @typedef {object} PlanStep
 * @property {string} id
 * @property {string} title
 * @property {'pending'|'running'|'done'|'skipped'|'failed'} status
 * @property {string} [tool]     - nama tool opsional
 * @property {object} [args]     - argumen tool opsional
 * @property {string} [note]     - catatan / hasil singkat
 */

/**
 * @typedef {object} Plan
 * @property {string} id
 * @property {string} goal
 * @property {'draft'|'active'|'blocked'|'done'|'cancelled'} status
 * @property {PlanStep[]} steps
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string} [userId]
 */

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Buat plan baru dari goal + daftar judul langkah.
 * @param {string} goal
 * @param {string[]} stepTitles
 * @param {object} [opts]
 * @returns {Plan}
 */
function createPlan(goal, stepTitles = [], opts = {}) {
  const titles = (Array.isArray(stepTitles) ? stepTitles : [])
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .slice(0, MAX_STEPS);

  const steps = titles.map((title, i) => ({
    id: `s${i + 1}`,
    title,
    status: 'pending',
    tool: undefined,
    args: undefined,
    note: undefined,
  }));

  const ts = nowIso();
  return {
    id: makeId('plan'),
    goal: String(goal || '').trim() || 'Untitled goal',
    status: steps.length ? 'draft' : 'draft',
    steps,
    createdAt: ts,
    updatedAt: ts,
    userId: opts.userId || undefined,
  };
}

/**
 * Validasi plan minimal.
 */
function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') {
    return { valid: false, reason: 'Plan harus object.' };
  }
  if (!plan.goal || typeof plan.goal !== 'string') {
    return { valid: false, reason: 'Plan.goal wajib string.' };
  }
  if (!Array.isArray(plan.steps)) {
    return { valid: false, reason: 'Plan.steps wajib array.' };
  }
  if (plan.steps.length > MAX_STEPS) {
    return { valid: false, reason: `Maksimal ${MAX_STEPS} langkah.` };
  }
  for (const s of plan.steps) {
    if (!s || !s.id || !s.title) {
      return { valid: false, reason: 'Setiap step wajib id + title.' };
    }
  }
  return { valid: true };
}

/**
 * Step pending pertama (yang akan dikerjakan).
 */
function getNextStep(plan) {
  if (!plan || !Array.isArray(plan.steps)) return null;
  return plan.steps.find((s) => s.status === 'pending') || null;
}

/**
 * Tandai step running.
 */
function markStepRunning(plan, stepId) {
  return updateStep(plan, stepId, { status: 'running' });
}

/**
 * Tandai step selesai / gagal.
 */
function markStepDone(plan, stepId, note) {
  return updateStep(plan, stepId, {
    status: 'done',
    note: note != null ? String(note).slice(0, 500) : undefined,
  });
}

function markStepFailed(plan, stepId, note) {
  return updateStep(plan, stepId, {
    status: 'failed',
    note: note != null ? String(note).slice(0, 500) : undefined,
  });
}

function updateStep(plan, stepId, patch) {
  if (!plan) return plan;
  const steps = plan.steps.map((s) =>
    s.id === stepId ? { ...s, ...patch } : s
  );
  const next = {
    ...plan,
    steps,
    updatedAt: nowIso(),
  };

  // Auto status plan
  if (steps.every((s) => s.status === 'done' || s.status === 'skipped')) {
    next.status = 'done';
  } else if (steps.some((s) => s.status === 'failed')) {
    next.status = 'blocked';
  } else if (steps.some((s) => s.status === 'running' || s.status === 'done')) {
    next.status = 'active';
  }

  return next;
}

/**
 * Teks ringkas untuk prompt / chat user.
 */
function formatPlanForDisplay(plan) {
  if (!plan) return '(tidak ada plan)';
  const lines = [
    `🎯 **Goal:** ${plan.goal}`,
    `Status: ${plan.status} · id: \`${plan.id}\``,
    '',
    '**Langkah:**',
  ];
  for (const s of plan.steps) {
    const icon =
      s.status === 'done'
        ? '✅'
        : s.status === 'running'
          ? '▶️'
          : s.status === 'failed'
            ? '❌'
            : s.status === 'skipped'
              ? '⏭️'
              : '⬜';
    lines.push(`${icon} ${s.id}. ${s.title}`);
    if (s.note) lines.push(`   └ ${s.note}`);
  }
  return lines.join('\n');
}

/**
 * Parse plan dari JSON LLM (toleran).
 * Expected:
 * {
 *   "goal": "...",
 *   "steps": ["langkah 1", "langkah 2"]
 * }
 * atau steps: [{ "title": "..." }]
 */
function planFromLlmJson(raw, opts = {}) {
  let data = raw;
  if (typeof raw === 'string') {
    let text = raw.trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a !== -1 && b > a) text = text.slice(a, b + 1);
    try {
      data = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== 'object') return null;

  const goal = String(data.goal || data.objective || '').trim();
  let titles = [];
  if (Array.isArray(data.steps)) {
    titles = data.steps.map((s) =>
      typeof s === 'string' ? s : String(s?.title || s?.name || '')
    );
  }

  if (!goal || !titles.length) return null;
  return createPlan(goal, titles, opts);
}

/**
 * Blok teks ringkas untuk disisipkan ke system prompt agent.
 */
function formatPlanForPrompt(plan) {
  if (!plan || !Array.isArray(plan.steps) || !plan.steps.length) {
    return '';
  }

  const next = plan.steps.find((s) => s.status === 'pending') || null;
  const lines = [
    '## PLAN AKTIF (multi-step)',
    `Goal: ${plan.goal}`,
    `Status plan: ${plan.status}`,
    `Plan id: ${plan.id}`,
    '',
    'Langkah:',
  ];

  for (const s of plan.steps) {
    const mark =
      s.status === 'done'
        ? '[x]'
        : s.status === 'running'
          ? '[~]'
          : s.status === 'failed'
            ? '[!]'
            : s.status === 'skipped'
              ? '[-]'
              : '[ ]';
    lines.push(`${mark} ${s.id}: ${s.title}`);
  }

  lines.push('');
  if (next) {
    lines.push(
      `FOKUS SEKARANG: kerjakan langkah "${next.id}: ${next.title}".`
    );
    lines.push(
      'Setelah progress nyata pada langkah itu, sebutkan di jawaban final. ' +
        'Jangan mengklaim semua langkah selesai jika masih ada [ ].'
    );
  } else if (plan.status === 'done') {
    lines.push('Semua langkah plan sudah selesai.');
  } else {
    lines.push('Tidak ada langkah pending.');
  }

  lines.push(
    'Tool agent-plan: action show|create|clear untuk kelola plan. ' +
      'Jangan buat plan baru jika plan aktif masih relevan, kecuali user minta ganti.'
  );

  return lines.join('\n');
}

/**
 * Ringkas status plan untuk pesan reflect ke model.
 */
function buildPlanReflectMessage(plan) {
  if (!plan) return '';

  const pending = plan.steps.filter((s) => s.status === 'pending');
  const done = plan.steps.filter((s) => s.status === 'done');
  const failed = plan.steps.filter((s) => s.status === 'failed');

  const lines = [
    '[SISTEM REFLECT PLAN]',
    `Goal: ${plan.goal}`,
    `Selesai: ${done.length}/${plan.steps.length}`,
  ];

  if (failed.length) {
    lines.push(`Gagal: ${failed.map((s) => s.id).join(', ')}`);
  }

  if (plan.status === 'done' || pending.length === 0) {
    lines.push(
      'Plan sudah selesai atau tidak ada langkah pending. ' +
        'WAJIB action "final" sekarang: ringkas hasil untuk user. ' +
        'Jangan panggil tool lagi kecuali user minta aksi baru.'
    );
  } else {
    const next = pending[0];
    lines.push(
      `Masih pending: ${pending.map((s) => s.id).join(', ')}. ` +
        `Fokus berikutnya: "${next.id}: ${next.title}". ` +
        'Jika info sudah cukup untuk menjawab user, boleh action "final" ' +
        'dan sebutkan sisa langkah yang belum dikerjakan.'
    );
  }

  return lines.join('\n');
}

/** Kata kunci kasar: family tool → token yang sering muncul di judul step */
const TOOL_HINTS = {
  'obsidian-search': ['cari', 'search', 'audit', 'list', 'temukan', 'scan', 'keyword'],
  'obsidian-context': ['konteks', 'context', 'topik', 'ringkas', 'overview'],
  'obsidian-read': ['baca', 'read', 'isi', 'detail', 'buka'],
  'obsidian-tree': ['folder', 'tree', 'struktur', 'direktori'],
  'obsidian-tags': ['tag', 'label'],
  'obsidian-backlinks': ['backlink', 'link', 'tautan'],
  'obsidian-normalize': ['rapikan', 'normalize', 'normalisasi', 'format', 'frontmatter'],
  'obsidian-organize': ['organize', 'organisir', 'pindah massal', 'audit vault'],
  'obsidian-create': ['buat', 'create', 'tulis note', 'note baru'],
  'obsidian-append': ['append', 'tambah', 'log', 'catat'],
  'obsidian-update': ['update', 'ubah', 'ganti isi', 'timpa'],
  'obsidian-move': ['pindah', 'move', 'rename', 'ganti nama'],
  'obsidian-delete': ['hapus', 'delete', 'buang'],
  fetch: ['fetch', 'web', 'url', 'harga', 'online', 'http'],
  shell: ['shell', 'terminal', 'perintah', 'command'],
  remember: ['ingat', 'remember', 'memori'],
};

/**
 * Apakah tool ini cukup cocok dengan judul langkah pending?
 * @returns {{ score: number, reason: string }}
 */
function scoreToolForStep(toolName, stepTitle) {
  const tool = String(toolName || '').toLowerCase();
  const title = String(stepTitle || '').toLowerCase();
  if (!tool || !title) return { score: 0, reason: 'empty' };

  let score = 0;
  const reasons = [];

  const short = tool.replace(/^obsidian-/, '');
  if (title.includes(tool) || title.includes(short)) {
    score += 0.6;
    reasons.push('name-in-title');
  }

  const hints = TOOL_HINTS[tool] || TOOL_HINTS[short] || [];
  for (const hint of hints) {
    if (hint && title.includes(hint)) {
      score += 0.35;
      reasons.push(`hint:${hint}`);
      break;
    }
  }

  if (tool.startsWith('obsidian-') && /vault|note|obsidian|markdown|\.md/.test(title)) {
    score += 0.2;
    reasons.push('vault-family');
  }

  if (
    /paham|konteks|rag|info|ringkas|jawab|hasil/.test(title) &&
    ['obsidian-search', 'obsidian-context', 'obsidian-read', 'fetch'].includes(tool)
  ) {
    score += 0.3;
    reasons.push('generic-research');
  }

  return {
    score: Math.min(1, score),
    reason: reasons.join(',') || 'no-match',
  };
}

/**
 * true jika boleh majukan step untuk tool ini.
 */
function shouldAdvanceStepForTool(toolName, stepTitle, { minScore = 0.35 } = {}) {
  const { score, reason } = scoreToolForStep(toolName, stepTitle);
  return {
    ok: score >= minScore,
    score,
    reason,
  };
}

module.exports = {
  MAX_STEPS,
  createPlan,
  validatePlan,
  getNextStep,
  markStepRunning,
  markStepDone,
  markStepFailed,
  updateStep,
  formatPlanForDisplay,
  planFromLlmJson,
  formatPlanForPrompt,
  buildPlanReflectMessage,
  scoreToolForStep,
  shouldAdvanceStepForTool,
};
