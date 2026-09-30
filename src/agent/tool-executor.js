const { loadSkills, getSkillManifest, runSkillByName } = require('../skills');
const { checkPermission } = require('../permission');
const { createApproval } = require('../approval');

loadSkills();

const TOOL_ARG_SCHEMAS = {
  ping: { required: ['host'], types: { host: 'string' } },
  readfile: { required: ['path'], types: { path: 'string' } },
  writefile: { required: ['path', 'content'], types: { path: 'string', content: 'string' } },
  'obsidian-read': { required: ['note'], types: { note: 'string' } },
  'obsidian-search': { required: ['query'], types: { query: 'string' } },
  'obsidian-tags': { required: [], types: {} },
  'obsidian-tree': { required: [], types: { path: 'string' } },
  'obsidian-backlinks': { required: ['note'], types: { note: 'string' } },
  'obsidian-context': { required: ['query'], types: { query: 'string' } },
  'obsidian-create': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-append': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-update': { required: ['note', 'content'], types: { note: 'string', content: 'string' } },
  'obsidian-delete': { required: ['path'], types: { path: 'string' } },
  'obsidian-move': { required: ['from', 'to'], types: { from: 'string', to: 'string' } },
  'obsidian-normalize': { required: ['path'], types: { path: 'string' } },
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

  const { action, reply, tool, args } = parsed;

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
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        return { valid: false, reason: `Tool "${tool}" membutuhkan field "args" bertipe object` };
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
            return { valid: false, reason: `Argumen "${key}" pada tool "${tool}" harus bertipe ${expectedType}, tapi dapat ${actualType}` };
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
  if (tool === 'shell') return `shell: ${args.command || ''}`;
  if (tool === 'fetch') return `fetch: ${args.url || ''}`;
  if (tool === 'device-info') return `device-info`;
  if (tool === 'remember') return `remember: ${args.fact || ''}`;
  if (tool === 'clawd-scan') return `clawd-scan`;

  return `${tool}: ${JSON.stringify(args)}`;
}

async function executeAction(parsed, meta = {}) {
  const { tool } = parsed;
  const toolCallString = convertActionToToolCallString(parsed);

  const perm = checkPermission(toolCallString);
  if (!perm.allowed) {
    return {
      status: 'blocked',
      error: `[SECURITY] ${perm.reason}`,
    };
  }

  const approvalReq = createApproval({
    tool: toolCallString,
    source: meta.source || 'webui',
    metadata: {
      clientIp: meta.clientIp,
      sessionUser: meta.user,
      channel: meta.source,
      chatId: meta.chatId,
    },
  });

  if (approvalReq.status === 'PENDING') {
    return {
      status: 'approval_required',
      approval: approvalReq,
      message:
        `⚠️ Eksekusi tool high-risk ditahan.\n\n` +
        `**ID Approval:** \`${approvalReq.id}\`\n` +
        `**Tool:** \`${approvalReq.tool}\`\n` +
        `**Risk:** ${approvalReq.policy.label}\n\n` +
        `Gunakan command berikut untuk melanjutkan:\n` +
        `\`approve ${approvalReq.id}\` atau \`reject ${approvalReq.id}\``,
    };
  }

  try {
    const output = await runSkillByName(tool, toolCallString);
    return {
      status: 'success',
      output: output || '(No output returned)',
    };
  } catch (err) {
    return {
      status: 'error',
      error: err.message,
    };
  }
}

module.exports = {
  TOOL_ARG_SCHEMAS,
  validateAgentAction,
  convertActionToToolCallString,
  executeAction,
};
