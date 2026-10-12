const fs = require('fs');
const path = require('path');
const {
  createPlan,
  validatePlan,
  formatPlanForDisplay,
  planFromLlmJson,
  getNextStep,
  markStepRunning,
  markStepDone,
  markStepFailed,
  updateStep,
  shouldAdvanceStepForTool,
} = require('./plan');
const { listTasks, markTaskDone } = require('./task-queue');

const PLANS_DIR = path.join(__dirname, '..', '..', 'data', 'plans');

function ensureDir() {
  fs.mkdirSync(PLANS_DIR, { recursive: true });
}

function safeUserId(userId) {
  return String(userId || 'anonymous').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
}

function planPath(userId) {
  return path.join(PLANS_DIR, `${safeUserId(userId)}.json`);
}

/**
 * Ambil plan aktif user (atau null).
 */
function loadPlan(userId) {
  const file = planPath(userId);
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const plan = JSON.parse(raw);
    const validation = validatePlan(plan);
    if (!validation.valid) {
      console.warn(`[plan-store] Invalid plan for ${safeUserId(userId)}: ${validation.reason}`);
      return null;
    }
    return plan;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    console.warn(`[plan-store] Could not load plan for ${safeUserId(userId)}: ${error.message}`);
    return null;
  }
}

/**
 * Simpan plan aktif user.
 */
function savePlan(userId, plan) {
  const validation = validatePlan(plan);
  if (!validation.valid) {
    throw new Error(validation.reason || 'Plan tidak valid');
  }
  ensureDir();
  const toSave = {
    ...plan,
    userId: safeUserId(userId),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(planPath(userId), JSON.stringify(toSave, null, 2), 'utf-8');
  return toSave;
}

/**
 * Hapus plan aktif.
 */
function clearPlan(userId) {
  const file = planPath(userId);
  try {
    fs.unlinkSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Buat + simpan plan baru (menimpa yang lama).
 */
function setNewPlan(userId, goal, stepTitles) {
  const plan = createPlan(goal, stepTitles, { userId: safeUserId(userId) });
  plan.status = 'draft';
  return savePlan(userId, plan);
}

/**
 * User mengizinkan plan dijalankan (draft → active).
 */
function activatePlan(userId) {
  const plan = loadPlan(userId);
  if (!plan) {
    return { ok: false, reason: 'Tidak ada plan.' };
  }
  if (plan.status === 'active') {
    return { ok: true, plan, reason: 'Plan sudah active.' };
  }
  if (plan.status === 'done') {
    return { ok: false, reason: 'Plan sudah selesai. Buat plan baru.' };
  }
  if (plan.status === 'cancelled') {
    return { ok: false, reason: 'Plan dibatalkan. Buat plan baru.' };
  }

  const next = {
    ...plan,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
  const saved = savePlan(userId, next);
  return { ok: true, plan: saved, reason: 'Plan diaktifkan.' };
}

/**
 * Jika plan baru selesai, tandai task terkait sebagai done.
 */
function syncTaskOnPlanDone(userId, plan) {
  if (!plan || plan.status !== 'done') return;

  try {
    const tasks = listTasks(userId, { includeDone: true });
    const related = tasks.filter(
      (task) =>
        task.status === 'active' &&
        (task.planId === plan.id ||
          String(task.title || '').trim() === String(plan.goal || '').trim())
    );

    for (const task of related) {
      markTaskDone(userId, task.id);
      console.log(
        `[plan-store] Task ${task.id} marked done (plan ${plan.id} finished)`
      );
    }
  } catch (err) {
    console.log('[plan-store] syncTaskOnPlanDone skipped:', err.message);
  }
}

/**
 * Setelah tool sukses: tandai langkah pending saat ini sebagai done.
 * Heuristic sederhana — 1 tool sukses ≈ 1 step maju.
 * @returns {{ plan: object|null, advanced: boolean, step: object|null }}
 */
function advancePlanAfterTool(userId, toolName, toolOutput) {
  const plan = loadPlan(userId);
  if (!plan) {
    return { plan: null, advanced: false, step: null };
  }
  if (plan.status === 'cancelled' || plan.status === 'done') {
    return { plan, advanced: false, step: null };
  }

  if (plan.status !== 'active') {
    // draft / blocked → jangan majukan step dari tool biasa
    return { plan, advanced: false, step: null };
  }

  // Jangan majukan plan hanya karena user melihat/mengubah plan
  if (toolName === 'agent-plan') {
    return { plan, advanced: false, step: null };
  }

  const next = getNextStep(plan);
  if (!next) {
    return { plan, advanced: false, step: null };
  }

  const fit = shouldAdvanceStepForTool(toolName, next.title);
  if (!fit.ok) {
    console.log(
      `[plan-store] skip advance: tool=${toolName} step=${next.id} score=${fit.score} (${fit.reason})`
    );
    const outputNote = String(toolOutput || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const note = [
      next.note,
      `Tool ${toolName} tidak memajukan langkah (score ${fit.score}): ${outputNote}`,
    ]
      .filter(Boolean)
      .join('\n')
      .slice(-500);
    const saved = savePlan(userId, updateStep(plan, next.id, { note }));
    return {
      plan: saved,
      advanced: false,
      step: null,
      skipped: true,
      fit,
    };
  }

  const note = String(toolOutput || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  let updated = markStepRunning(plan, next.id);
  updated = markStepDone(updated, next.id, `via ${toolName}: ${note}`);

  const saved = savePlan(userId, updated);
  if (saved.status === 'done') {
    syncTaskOnPlanDone(userId, saved);
  }
  return { plan: saved, advanced: true, step: next };
}

module.exports = {
  loadPlan,
  savePlan,
  clearPlan,
  setNewPlan,
  activatePlan,
  formatPlanForDisplay,
  planFromLlmJson,
  getNextStep,
  markStepRunning,
  markStepDone,
  markStepFailed,
  createPlan,
  validatePlan,
  advancePlanAfterTool,
};
