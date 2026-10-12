const fs = require('fs');
const path = require('path');

const TRACES_DIR = path.join(__dirname, '..', '..', 'data', 'traces');
const MAX_OUTPUT_CHARS = 800;
const MAX_TRACES_PER_USER = 100;
const SENSITIVE_ARG_KEY = /(password|secret|token|api.?key|authorization|credential)/i;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeUserId(userId) {
  return String(userId || 'anonymous')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64);
}

function makeRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function userDir(userId) {
  return path.join(TRACES_DIR, safeUserId(userId));
}

function truncate(text, max = MAX_OUTPUT_CHARS) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[+${s.length - max}]`;
}

function safeArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return Object.fromEntries(
    Object.entries(args)
      .slice(0, 20)
      .map(([key, value]) => [
        key,
        SENSITIVE_ARG_KEY.test(key)
          ? '[REDACTED]'
          : typeof value === 'string'
            ? truncate(value, 300)
            : value,
      ])
  );
}

/**
 * Mulai trace baru untuk satu run agent.
 */
function startTrace(userId, meta = {}) {
  return {
    runId: makeRunId(),
    userId: safeUserId(userId),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    source: meta.source || 'unknown',
    userMessage: truncate(meta.userMessage || '', 500),
    intent: meta.intent
      ? {
          type: meta.intent.type,
          confidence: meta.intent.confidence,
          skipRag: meta.intent.skipRag,
        }
      : null,
    planId: meta.planId || null,
    steps: [],
    tools: [],
    status: 'running',
    answerPreview: null,
    error: null,
  };
}

function recordTool(trace, { tool, args, status, output }) {
  if (!trace) return;
  const at = new Date().toISOString();
  trace.tools.push({
    at,
    tool: String(tool || ''),
    args: safeArgs(args),
    status: status || 'ok',
    output: truncate(output, MAX_OUTPUT_CHARS),
  });
  trace.steps.push({
    at,
    type: 'tool',
    tool: String(tool || ''),
    status: status || 'ok',
  });
}

function finishTrace(trace, { status, answer, error } = {}) {
  if (!trace) return null;
  trace.finishedAt = new Date().toISOString();
  trace.status = status || 'answered';
  if (answer != null) trace.answerPreview = truncate(answer, 500);
  if (error != null) trace.error = truncate(error, 400);
  return saveTrace(trace);
}

function saveTrace(trace) {
  if (!trace || !trace.runId) return null;
  const dir = userDir(trace.userId);
  ensureDir(dir);
  const file = path.join(dir, `${trace.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(trace, null, 2), 'utf-8');
  pruneOldTraces(trace.userId);
  return file;
}

/**
 * Hapus trace lama jika terlalu banyak (keep newest).
 */
function pruneOldTraces(userId) {
  const dir = userDir(userId);
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const full = path.join(dir, file);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const file of files.slice(MAX_TRACES_PER_USER)) {
    fs.unlinkSync(file.full);
  }
}

function listTraces(userId, limit = 10) {
  const dir = userDir(userId);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const full = path.join(dir, file);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, Math.max(0, limit))
    .flatMap(({ full }) => {
      try {
        return [JSON.parse(fs.readFileSync(full, 'utf-8'))];
      } catch (error) {
        console.warn(`[trace] Could not read ${path.basename(full)}: ${error.message}`);
        return [];
      }
    });
}

function formatTraceList(userId, limit = 5) {
  const traces = listTraces(userId, limit);
  if (!traces.length) return 'Belum ada trace agent.';
  const lines = ['🕵️ **Trace terakhir**', ''];
  for (const trace of traces) {
    lines.push(
      `• \`${trace.runId}\` — ${trace.status} — ${trace.intent?.type || '?'} — tools: ${(trace.tools || []).map((tool) => tool.tool).join(', ') || '-'}`
    );
    if (trace.userMessage) lines.push(`  Q: ${trace.userMessage.slice(0, 80)}`);
  }
  return lines.join('\n');
}

module.exports = {
  startTrace,
  recordTool,
  finishTrace,
  saveTrace,
  listTraces,
  formatTraceList,
};
