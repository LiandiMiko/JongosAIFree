const fs = require('fs');
const path = require('path');

const QUEUE_DIR = path.join(__dirname, '..', '..', 'data', 'tasks');

function ensureDir() {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

function safeUserId(userId) {
  return String(userId || 'anonymous')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

function queuePath(userId) {
  return path.join(QUEUE_DIR, `${safeUserId(userId)}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @returns {{ userId: string, tasks: array, updatedAt: string }}
 */
function loadQueue(userId) {
  ensureDir();
  const file = queuePath(userId);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!data || typeof data !== 'object' || !Array.isArray(data.tasks)) {
      throw new Error('Queue format invalid: tasks harus berupa array.');
    }
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { userId: safeUserId(userId), tasks: [], updatedAt: nowIso() };
    }
    throw new Error(`Gagal membaca task queue ${safeUserId(userId)}: ${error.message}`);
  }
}

function saveQueue(userId, queue) {
  ensureDir();
  const toSave = {
    userId: safeUserId(userId),
    tasks: Array.isArray(queue.tasks) ? queue.tasks : [],
    updatedAt: nowIso(),
  };
  fs.writeFileSync(queuePath(userId), JSON.stringify(toSave, null, 2), 'utf-8');
  return toSave;
}

/**
 * Tambah task.
 * @param {string} userId
 * @param {string} title
 * @param {string[]} [steps]
 */
function addTask(userId, title, steps = []) {
  const q = loadQueue(userId);
  const task = {
    id: makeId(),
    title: String(title || '').trim() || 'Untitled task',
    steps: (Array.isArray(steps) ? steps : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 8),
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    planId: null,
  };
  q.tasks.push(task);
  saveQueue(userId, q);
  return task;
}

function listTasks(userId, { includeDone = false } = {}) {
  const q = loadQueue(userId);
  return q.tasks.filter((task) => includeDone || task.status !== 'done');
}

function getTask(userId, taskId) {
  const q = loadQueue(userId);
  return q.tasks.find((task) => task.id === taskId) || null;
}

/**
 * Task pending tertua.
 */
function peekNext(userId) {
  const q = loadQueue(userId);
  return q.tasks.find((task) => task.status === 'pending') || null;
}

function updateTask(userId, taskId, patch) {
  const q = loadQueue(userId);
  const idx = q.tasks.findIndex((task) => task.id === taskId);
  if (idx === -1) return null;
  q.tasks[idx] = {
    ...q.tasks[idx],
    ...patch,
    updatedAt: nowIso(),
  };
  saveQueue(userId, q);
  return q.tasks[idx];
}

function markTaskDone(userId, taskId) {
  return updateTask(userId, taskId, { status: 'done' });
}

function cancelTask(userId, taskId) {
  return updateTask(userId, taskId, { status: 'cancelled' });
}

function formatQueueForDisplay(userId, { includeDone = false } = {}) {
  const tasks = listTasks(userId, { includeDone });
  if (!tasks.length) {
    return (
      '📭 Antrian task kosong.\n\n' +
      'Tambah: `task add: Judul | langkah 1 | langkah 2`'
    );
  }

  const lines = ['📋 **Antrian task**', ''];
  for (const task of tasks) {
    const icon =
      task.status === 'done'
        ? '✅'
        : task.status === 'active'
          ? '▶️'
          : task.status === 'cancelled'
            ? '⛔'
            : '⬜';
    lines.push(`${icon} \`${task.id}\` — **${task.title}** (${task.status})`);
    if (task.steps && task.steps.length) {
      lines.push(`   langkah: ${task.steps.join(' · ')}`);
    }
  }
  lines.push('');
  lines.push('_`task next` = ambil pending → plan draft · `plan go` = kerjakan_');
  return lines.join('\n');
}

module.exports = {
  loadQueue,
  saveQueue,
  addTask,
  listTasks,
  getTask,
  peekNext,
  updateTask,
  markTaskDone,
  cancelTask,
  formatQueueForDisplay,
};
