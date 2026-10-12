const {
  addTask,
  peekNext,
  getTask,
  updateTask,
  markTaskDone,
  cancelTask,
  formatQueueForDisplay,
} = require('../src/agent/task-queue');
const {
  setNewPlan,
  loadPlan,
  formatPlanForDisplay,
} = require('../src/agent/plan-store');

function parseAdd(text) {
  const raw = String(text || '')
    .replace(/^(task add:|tambah task:|agent-task:)\s*/i, '')
    .trim();

  if (!raw) return null;

  const parts = raw.split('|').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;

  return {
    title: parts[0],
    steps: parts.slice(1),
  };
}

module.exports = {
  name: 'agent-task',
  description:
    'Antrian goal/task lintas sesi. ' +
    'task / task list · task add: judul | step1 | step2 · ' +
    'task next · task done: id · task cancel: id',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return (
      t === 'task' ||
      t === 'tasks' ||
      t === 'task list' ||
      t === 'antrian' ||
      t === 'task next' ||
      t.startsWith('task add:') ||
      t.startsWith('tambah task:') ||
      t.startsWith('task done:') ||
      t.startsWith('task cancel:') ||
      t.startsWith('agent-task:')
    );
  },

  async run(text, ctx = {}) {
    const userId = ctx.userId || 'local';
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();

    if (
      lower === 'task' ||
      lower === 'tasks' ||
      lower === 'task list' ||
      lower === 'antrian'
    ) {
      return formatQueueForDisplay(userId, { includeDone: false });
    }

    if (
      lower.startsWith('task add:') ||
      lower.startsWith('tambah task:') ||
      lower.startsWith('agent-task:')
    ) {
      if (lower.startsWith('agent-task:')) {
        const rest = raw.replace(/^agent-task:\s*/i, '').trim();
        if (!rest || rest.toLowerCase() === 'list') {
          return formatQueueForDisplay(userId);
        }
        const parsed = parseAdd(`task add: ${rest}`);
        if (!parsed) return 'Format: task add: Judul | langkah 1 | langkah 2';
        const task = addTask(userId, parsed.title, parsed.steps);
        return (
          `➕ Task ditambah: \`${task.id}\`\n**${task.title}**\n\n` +
          formatQueueForDisplay(userId)
        );
      }

      const parsed = parseAdd(raw);
      if (!parsed) return 'Format: task add: Judul | langkah 1 | langkah 2';
      const task = addTask(userId, parsed.title, parsed.steps);
      return (
        `➕ Task ditambah: \`${task.id}\`\n**${task.title}**\n\n` +
        formatQueueForDisplay(userId)
      );
    }

    if (lower === 'task next') {
      const existingPlan = loadPlan(userId);
      if (
        existingPlan &&
        !['done', 'cancelled'].includes(existingPlan.status)
      ) {
        return (
          '⚠️ Masih ada plan berjalan/draft.\n\n' +
          formatPlanForDisplay(existingPlan) +
          '\n\nSelesaikan (`plan go` + kerja) atau `plan clear` dulu, baru `task next`.'
        );
      }

      const task = peekNext(userId);
      if (!task) return 'Tidak ada task pending.';

      const steps =
        task.steps && task.steps.length
          ? task.steps
          : [
              'Pahami konteks dari vault/RAG',
              'Kumpulkan info yang kurang',
              'Lakukan aksi utama',
              'Ringkas hasil',
            ];

      const plan = setNewPlan(userId, task.title, steps);
      updateTask(userId, task.id, {
        status: 'active',
        planId: plan.id,
      });

      return (
        `▶️ Task diambil: \`${task.id}\`\n` +
        `Plan **draft** dibuat dari task ini.\n\n` +
        formatPlanForDisplay(plan) +
        '\n\nKetik **`plan go`** untuk mulai mengerjakan.'
      );
    }

    if (lower.startsWith('task done:')) {
      const id = raw.replace(/^task done:\s*/i, '').trim();
      if (!id) return 'Format: task done: task_xxx';
      const task = getTask(userId, id);
      if (!task) return `Task tidak ditemukan: ${id}`;
      markTaskDone(userId, id);
      return `✅ Task selesai: \`${id}\` — ${task.title}`;
    }

    if (lower.startsWith('task cancel:')) {
      const id = raw.replace(/^task cancel:\s*/i, '').trim();
      if (!id) return 'Format: task cancel: task_xxx';
      const task = getTask(userId, id);
      if (!task) return `Task tidak ditemukan: ${id}`;
      cancelTask(userId, id);
      return `⛔ Task dibatalkan: \`${id}\` — ${task.title}`;
    }

    return formatQueueForDisplay(userId);
  },
};
