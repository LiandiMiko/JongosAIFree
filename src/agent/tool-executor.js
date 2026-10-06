const { loadSkills, getSkillManifest, runSkillByName } = require('../skills');
const { checkPermission } = require('../permission');
const { createApproval } = require('../approval');
const { getToolPolicy } = require('../tool-policy');

// Ensure skills are loaded once
loadSkills();

const TOOL_ARG_SCHEMAS = {
  ping: { required: ['host'], types: { host: 'string' } },
  readfile: { required: ['path'], types: { path: 'string' } },
  writefile: { required: ['path', 'content'], types: { path: 'string', content: 'string' } },
  'obsidian-read': { required: ['note'], types: { note: 'string' } },
  'obsidian-search': { required: ['query'], types: { query: 'string' } },
  'obsidian-tags': { required: [], types: { tag: 'string' } },
  'obsidian-tree': { required: [], types: { path: 'string' } },
  'obsidian-backlinks': { required: ['note'], types: { note: 'string' } },
  'obsidian-context': { required: ['query'], types: { query: 'string' } },
  'obsidian-create': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-append': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-update': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-delete': { required: ['path'], types: { path: 'string' } },
  'obsidian-move': { required: ['from', 'to'], types: { from: 'string', to: 'string' } },
  'obsidian-normalize': { required: ['path'], types: { path: 'string' } },
  'obsidian-organize': { required: [], types: { mode: 'string' } },
  shell: { required: ['command'], types: { command: 'string' } },
  fetch: { required: ['url'], types: { url: 'string' } },
  'device-info': { required: [], types: {} },
  addskill: { required: ['name', 'description', 'code'], types: { name: 'string', description: 'string', code: 'string' } },
  delskills: { required: ['name'], types: { name: 'string' } },
  remember: { required: ['fact'], types: { fact: 'string' } },
  'clawd-scan': { required: [], types: {} },
};

function validateAgentAction(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, reason: 'Response bukan JSON object valid' };
  }

  const { action, reply, tool } = parsed;
  let { args } = parsed;

  if (!['final', 'tool'].includes(action)) {
    return { valid: false, reason: `Action "${action}" tidak dikenal. Gunakan "final" atau "tool"` };
  }

  if (action === 'final') {
    if (!reply || typeof reply !== 'string' || !reply.trim()) {
      return { valid: false, reason: 'Action "final" membutuhkan field "reply" bertipe string' };
    }
    return { valid: true };
  }

  if (action === 'tool') {
    if (!tool || typeof tool !== 'string') {
      return { valid: false, reason: 'Action "tool" membutuhkan field "tool" bertipe string' };
    }

    const availableSkills = getSkillManifest();
    const skillExists = availableSkills.some((s) => s.name === tool);
    if (!skillExists) {
      return { valid: false, reason: `Tool "${tool}" tidak terdaftar di agent` };
    }

    const schema = TOOL_ARG_SCHEMAS[tool];
    if (schema) {
      // FIX D12: Normalize args BEFORE validation so LLM-provided 'path' aliases 'note'
      // Previously normalizeToolArgs ran AFTER validateAgentAction, causing valid LLM
      // responses with {path: "..."} to fail with "Argumen 'note' wajib diisi"
      args = normalizeToolArgs(tool, args || {});
      parsed.args = args;

      // FIX D13: Allow omitting 'args' field when no required args exist
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        if (schema.required.length === 0) {
          args = {};
          parsed.args = {};
        } else {
          return { valid: false, reason: `Tool "${tool}" membutuhkan field "args" bertipe object` };
        }
      }

      for (const field of schema.required) {
        if (!(field in args) || args[field] === undefined || args[field] === null) {
          return { valid: false, reason: `Argumen "${field}" wajib diisi untuk tool "${tool}"` };
        }
      }

      for (const [key, expectedType] of Object.entries(schema.types)) {
        if (key in args && args[key] !== null && args[key] !== undefined) {
          const actualType = typeof args[key];
          if (actualType !== expectedType) {
            return {
              valid: false,
              reason: `Argumen "${key}" pada tool "${tool}" harus bertipe ${expectedType}, tapi dapat ${actualType}`,
            };
          }
        }
      }
    }

    return { valid: true };
  }

  return { valid: false, reason: 'Struktur action tidak valid' };
}


function convertActionToToolCallString(parsed) {
  const { tool, args = {} } = parsed;

  if (tool === 'ping') return `ping ${args.host || ''}`;
  if (tool === 'readfile') return `readfile ${args.path || ''}`;
  if (tool === 'writefile') return `writefile ${args.path || ''} ${args.content || ''}`;
  if (tool === 'obsidian-read') return `obsidian-read: ${args.note || args.path || ''}`;
  if (tool === 'obsidian-search') return `obsidian-search: ${args.query || ''}`;
  if (tool === 'obsidian-tags') return `obsidian-tags: ${args.tag || ''}`;
  if (tool === 'obsidian-tree') return `obsidian-tree: ${args.path || ''}`;
  if (tool === 'obsidian-backlinks') return `obsidian-backlinks: ${args.note || ''}`;
  if (tool === 'obsidian-context') return `obsidian-context: ${args.query || ''}`;
  if (tool === 'obsidian-create') return `obsidian-create: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-append') return `obsidian-append: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-update') return `obsidian-update: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-delete') return `obsidian-delete: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-move') return `obsidian-move: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-normalize') return `obsidian-normalize: ${JSON.stringify(args)}`;
  if (tool === 'obsidian-organize') return `obsidian-organize: ${JSON.stringify(args)}`;
  if (tool === 'shell') return `shell: ${args.command || ''}`;
  if (tool === 'fetch') return `fetch: ${args.url || ''}`;
  if (tool === 'device-info') return `device-info`;
  if (tool === 'remember') return `remember: ${args.fact || ''}`;
  if (tool === 'clawd-scan') return `clawd-scan`;
  if (tool === 'addskill') return `addskill: ${JSON.stringify(args)}`;
  if (tool === 'delskills') return `delskills: ${args.name || ''}`;

  return `${tool}: ${JSON.stringify(args)}`;
}

/**
 * Execute a parsed agent action (tool call).
 * Returns structured result:
 *   { status: 'success', output }
 *   { status: 'blocked', error }
 *   { status: 'error', error }
 *   { status: 'approval_required', requestId, tool, args, policy, message }
 */
/**
 * Hard policy checks before permission / approval gates.
 * Blocks shell-as-browser, date via shell, chaining, etc.
 */
function checkHardToolPolicy(tool, args = {}, meta = {}) {
  const intent = meta.intent || null;

  if (intent && Array.isArray(intent.blockTools) && intent.blockTools.includes(tool)) {
    return {
      blocked: true,
      error:
        `[POLICY] Tool "${tool}" diblokir untuk intent "${intent.type}". ` +
        (intent.preferTools?.length
          ? `Gunakan: ${intent.preferTools.join(', ')}.`
          : 'Jawab final jika memungkinkan.'),
    };
  }

  if (tool === 'shell') {
    const cmd = String(args.command || '').trim();
    const lower = cmd.toLowerCase();

    // No empty command
    if (!cmd) {
      return { blocked: true, error: '[POLICY] Command shell kosong.' };
    }

    // No chaining / redirection
    if (/[;&|`]|\$\(|&&|\|\||>|<|\n/.test(cmd)) {
      return {
        blocked: true,
        error:
          '[POLICY] Shell hanya boleh satu command sederhana. Dilarang chaining (&&, ||, ;, |), redirect, backtick, atau $().',
      };
    }

    // Shell must not be used as browser / price checker
    if (
      /\b(curl|wget|http:\/\/|https:\/\/|fetch|axios)\b/.test(lower) ||
      /binance|coingecko|coinmarketcap|ticker|ondousdt|taousdt|api\.|\.com\/|\.io\//.test(
        lower
      )
    ) {
      return {
        blocked: true,
        error:
          '[POLICY] Jangan pakai shell untuk akses web/harga. Gunakan tool fetch dengan URL (contoh Binance ticker).',
      };
    }

    // Date/time via shell → use server time instead
    if (
      /^(date|timedatectl)\b/.test(lower) ||
      /\b(date\s+%|clock)\b/.test(lower)
    ) {
      return {
        blocked: true,
        error:
          '[POLICY] Jangan pakai shell untuk cek tanggal/jam. Gunakan waktu server yang sudah tersedia di system prompt.',
      };
    }
  }

  if (tool === 'fetch') {
    const url = String(args.url || '').trim();
    if (!url) {
      return { blocked: true, error: '[POLICY] URL fetch kosong.' };
    }
    if (!/^https?:\/\//i.test(url)) {
      return {
        blocked: true,
        error: '[POLICY] fetch hanya menerima URL http/https yang valid.',
      };
    }
  }

  return { blocked: false };
}

/**
 * Execute a parsed agent action (tool call).
 * Returns structured result:
 *   { status: 'success', output }
 *   { status: 'blocked', error }
 *   { status: 'error', error }
 *   { status: 'approval_required', requestId, tool, args, policy, message }
 */
function normalizeToolArgs(tool, args = {}) {
  const a = { ...args };
  // Skills expect `path`; agent schema often sends `note`
  if (['obsidian-append', 'obsidian-create', 'obsidian-update', 'obsidian-read'].includes(tool)) {
    if (!a.path && a.note) a.path = a.note;
    if (!a.note && a.path) a.note = a.path;
  }
  return a;
}

async function executeAction(parsed, meta = {}) {
  const tool = parsed.tool;
  const args = normalizeToolArgs(tool, parsed.args || {});
  parsed = { ...parsed, args };
  const toolCallString = convertActionToToolCallString(parsed);
  const userId = meta.userId || meta.user || 'anonymous';

  const hard = checkHardToolPolicy(tool, args, meta);
  if (hard.blocked) {
    return { status: 'blocked', error: hard.error };
  }

  // Security permission check
  const perm = checkPermission(toolCallString);
  if (!perm.allowed) {
    return {
      status: 'blocked',
      error: `[SECURITY] ${perm.reason}`,
    };
  }

  // Risk / approval gate
  const policy = getToolPolicy(tool);
  if (policy.level >= 2) {
    // HIGH risk → require user approval
    const request = createApproval(userId, tool, args, policy, {
      userText: meta.userText || '',
      history: meta.history || [],
      step: meta.step || 0,
      toolCallString,
      source: meta.source || 'agent',
    });

    return {
      status: 'approval_required',
      requestId: request.requestId,
      tool,
      args,
      policy,
      message:
        `⚠️ Tool high-risk ditahan menunggu approval.\n\n` +
        `Tool: \`${tool}\`\n` +
        `Risk: ${policy.label}\n` +
        `ID: \`${request.requestId}\``,
    };
  }

  // Low / medium risk → execute immediately
  try {
    const ctx = {
      userId,
      config: meta.config || {},
      source: meta.source || 'agent',
    };
    const output = await runSkillByName(tool, toolCallString, ctx);
    return {
      status: 'success',
      output: output || '(No output returned)',
      tool,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      tool,
    };
  }
}

/**
 * Execute an already-approved tool request (after user clicks Allow).
 */
async function executeApprovedTool(request, meta = {}) {
  const tool = request.tool;
  const args = request.args || {};
  const toolCallString =
    (request.continuation && request.continuation.toolCallString) ||
    convertActionToToolCallString({ tool, args });

  const perm = checkPermission(toolCallString);
  if (!perm.allowed) {
    return {
      status: 'blocked',
      error: `[SECURITY] ${perm.reason}`,
    };
  }

  try {
    const ctx = {
      userId: request.userId,
      config: meta.config || {},
      source: meta.source || 'approval',
    };
    const output = await runSkillByName(tool, toolCallString, ctx);
    return {
      status: 'executed',
      output: output || '(No output returned)',
      tool,
      args,
      request,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
      message: err.message, // FIX Q13: consistent with executeAction return shape
      tool,
    };
  }
}

module.exports = {
  TOOL_ARG_SCHEMAS,
  validateAgentAction,
  convertActionToToolCallString,
  executeAction,
  executeApprovedTool,
  checkHardToolPolicy,
  normalizeToolArgs,
};
