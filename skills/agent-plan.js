const {
  loadPlan,
  clearPlan,
  setNewPlan,
  activatePlan,
  formatPlanForDisplay,
  planFromLlmJson,
} = require('../src/agent/plan-store');

function parseCreate(text) {
  const raw = String(text || '')
    .replace(/^(agent-plan:|plan:|buat plan:|create plan:)\s*/i, '')
    .trim();

  if (raw.startsWith('{')) {
    const plan = planFromLlmJson(raw, {});
    if (plan) {
      return { goal: plan.goal, steps: plan.steps.map((s) => s.title) };
    }
  }

  const parts = raw.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { goal: parts[0], steps: parts.slice(1) };
  }

  if (parts.length === 1) {
    return {
      goal: parts[0],
      steps: [
        'Pahami konteks dari vault/RAG',
        'Kumpulkan info yang kurang',
        'Lakukan aksi utama',
        'Ringkas hasil untuk user',
      ],
    };
  }

  return null;
}

module.exports = {
  name: 'agent-plan',
  description:
    'Kelola plan multi-step. ' +
    'action=show|create|clear. ' +
    'create butuh goal + steps (string dipisah |). ' +
    'Contoh user: "plan: Rapikan Network | audit | normalize 3 note"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return (
      t === 'plan' ||
      t === 'agent-plan' ||
      t === 'lihat plan' ||
      t === 'plan go' ||
      t === 'plan jalankan' ||
      t === 'jalankan plan' ||
      t === 'plan clear' ||
      t === 'hapus plan' ||
      t.startsWith('plan:') ||
      t.startsWith('agent-plan:') ||
      t.startsWith('buat plan:') ||
      t.startsWith('create plan:')
    );
  },

  async run(text, ctx = {}) {
    const userId = ctx.userId || 'local';
    const t = String(text || '').trim();
    const lower = t.toLowerCase();

    if (
      lower === 'plan go' ||
      lower === 'plan jalankan' ||
      lower === 'jalankan plan'
    ) {
      const res = activatePlan(userId);
      if (!res.ok) {
        return `❌ ${res.reason}`;
      }
      return (
        `▶️ ${res.reason}\n\n` +
        formatPlanForDisplay(res.plan) +
        '\n\n_Tool sukses berikutnya akan memajukan langkah plan._'
      );
    }

    if (lower === 'plan clear' || lower === 'hapus plan') {
      const ok = clearPlan(userId);
      return ok
        ? '🧹 Plan aktif dihapus.'
        : 'Tidak ada plan aktif untuk dihapus.';
    }

    if (
      lower === 'plan' ||
      lower === 'agent-plan' ||
      lower === 'lihat plan'
    ) {
      const plan = loadPlan(userId);
      if (!plan) {
        return (
          'Belum ada plan aktif.\n\n' +
          'Buat: `plan: Goal | langkah 1 | langkah 2`'
        );
      }
      return formatPlanForDisplay(plan);
    }

    const parsed = parseCreate(t);
    if (!parsed) {
      return 'Format: `plan: Goal | langkah 1 | langkah 2 | langkah 3`';
    }

    const plan = setNewPlan(userId, parsed.goal, parsed.steps);
    return (
      '📝 Plan disimpan sebagai **draft** (belum jalan).\n\n' +
      formatPlanForDisplay(plan) +
      '\n\nKetik `plan go` untuk mengaktifkan, atau `plan clear` untuk batal.'
    );
  },
};
