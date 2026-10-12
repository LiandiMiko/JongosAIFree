const { formatTraceList, listTraces } = require('../src/agent/trace');

module.exports = {
  name: 'agent-trace',
  description:
    'Lihat jejak run agent terakhir. ' +
    'Contoh: "trace" atau "agent-trace"',

  trigger(text) {
    const t = String(text || '').trim().toLowerCase();
    return (
      t === 'trace' ||
      t === 'traces' ||
      t === 'agent-trace' ||
      t === 'jejak' ||
      t.startsWith('trace:') ||
      t.startsWith('agent-trace:')
    );
  },

  async run(text, ctx = {}) {
    const userId = ctx.userId || 'local';
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();

    let limit = 5;
    const match = lower.match(/(?:trace|agent-trace):\s*(\d+)/);
    if (match) {
      limit = Math.min(20, Math.max(1, parseInt(match[1], 10) || 5));
    }

    const list = formatTraceList(userId, limit);
    const traces = listTraces(userId, limit);
    if (!traces.length) return list;

    const last = traces[0];
    const detail = [
      '',
      '---',
      `📌 Terbaru: \`${last.runId}\``,
      `Status: ${last.status}`,
      `Intent: ${last.intent?.type || '-'}`,
      `Plan: ${last.planId || '-'}`,
      `Tools: ${(last.tools || []).map((tool) => `${tool.tool}(${tool.status})`).join(', ') || '-'}`,
    ];

    return list + '\n' + detail.join('\n');
  },
};
