const {
  loadSkills,
  getSkillManifest,
  runSkillByName,
} = require('./skills');

loadSkills();
const { checkPermission } = require('./permission');
const {
  createApproval,
} = require('./approval');
const { callLLM } = require('./llm');

/**
 * Build tool manifest for the LLM.
 *
 * The LLM will use this information to decide
 * whether it should answer normally or call a tool.
 */
function buildToolManifest() {
  return getSkillManifest();
}

/**
 * Validate an agent action before execution.
 *
 * Expected action:
 *
 * {
 *   action: "tool",
 *   tool: "ping",
 *   args: {
 *     host: "8.8.8.8"
 *   }
 * }
 */

const TOOL_ARG_SCHEMAS = {
  ping: {
    required: ['host'],
    types: {
      host: 'string',
    },
  },

  readfile: {
    required: ['path'],
    types: {
      path: 'string',
    },
  },

  writefile: {
    required: ['path', 'content'],
    types: {
      path: 'string',
      content: 'string',
    },
  },

  shell: {
    required: ['command'],
    types: {
      command: 'string',
    },
  },

  fetch: {
    required: ['url'],
    types: {
      url: 'string',
    },
  },

  remember: {
    required: ['note'],
    types: {
      note: 'string',
    },
  },

  'clawd-scan': {
    required: ['address'],
    types: {
      address: 'string',
    },
  },

  'device-info': {
    required: ['action'],
    types: {
      action: 'string',
    },
  },

  addskill: {
    required: ['name', 'code'],
    types: {
      name: 'string',
      code: 'string',
    },
  },

  delskills: {
    required: ['name'],
    types: {
      name: 'string',
    },
  },
};

function validateToolAction(action) {
  if (!action || typeof action !== 'object') {
    return {
      valid: false,
      reason: 'Action harus berupa object.',
    };
  }

  if (action.action !== 'tool') {
    return {
      valid: false,
      reason: 'Action bukan tool.',
    };
  }

  if (
    !action.tool ||
    typeof action.tool !== 'string'
  ) {
    return {
      valid: false,
      reason: 'Nama tool tidak valid.',
    };
  }

  const tool = action.tool;
  const schema = TOOL_ARG_SCHEMAS[tool];

  if (!schema) {
    return {
      valid: false,
      reason: `Tool "${tool}" tidak terdaftar.`,
    };
  }

  const args = action.args || {};

  if (
    typeof args !== 'object' ||
    args === null ||
    Array.isArray(args)
  ) {
    return {
      valid: false,
      reason: `Args untuk tool "${tool}" harus berupa object.`,
    };
  }

  for (const field of schema.required) {
    if (
      args[field] === undefined ||
      args[field] === null ||
      args[field] === ''
    ) {
      return {
        valid: false,
        reason:
          `Argument "${field}" wajib diisi untuk tool "${tool}".`,
      };
    }
  }

  for (const [field, expectedType] of Object.entries(schema.types)) {
    if (args[field] === undefined) {
      continue;
    }

    if (typeof args[field] !== expectedType) {
      return {
        valid: false,
        reason:
          `Argument "${field}" pada tool "${tool}" harus bertipe ${expectedType}.`,
      };
    }
  }

  return {
    valid: true,
  };
}

/**
 * Convert structured agent arguments into the
 * existing skill input format.
 *
 * Existing skills currently expect text input,
 * so we keep the current skill system unchanged.
 */
function buildSkillInput(tool, args = {}) {
  switch (tool) {
    case 'ping':
      return `ping: ${args.host || ''}`;

    case 'readfile':
      return `read: ${args.path || ''}`;

    case 'writefile':
      return `write: ${args.path || ''} | ${args.content || ''}`;

    case 'shell':
      return `run: ${args.command || ''}`;

    case 'fetch':
      return `fetch: ${args.url || ''}`;

    case 'remember':
      return `remember that ${args.note || ''}`;

    case 'clawd-scan':
      return `scan: ${args.address || ''}`;

    case 'device-info':
      return `device: ${args.action || ''}`;

    case 'addskill':
      return `addskill: ${args.name || ''} | ${args.code || ''}`;

    case 'delskills':
      return `delskill: ${args.name || ''}`;

    default:
      throw new Error(
        `Tool "${tool}" belum memiliki argument adapter.`
      );
  }
}

/**
 * Execute an agent-selected tool.
 *
 * LOW-risk tools execute automatically.
 * MEDIUM/HIGH-risk tools return an approval request.
 */
async function executeAgentTool(action, ctx) {
  const validation = validateToolAction(action);

  if (!validation.valid) {
    return {
      status: 'error',
      message: validation.reason,
    };
  }

  const tool = action.tool;
  const args = action.args || {};

  const permission = checkPermission(tool);
  
 if (permission.requiresApproval) {
  if (!ctx?.userId) {
    return {
      status: 'error',
      tool,
      args,
      message: 'Approval membutuhkan userId.',
    };
  }
 
  const approval = createApproval(
  ctx.userId,
  tool,
  args,
  permission.policy,
  {
   userText: ctx.userText,
    history: Array.isArray(ctx.continuationHistory)
      ? ctx.continuationHistory
      : [],
    step: Number.isInteger(ctx.continuationStep)
      ? ctx.continuationStep
      : 0,
  }
);

  return {
    status: 'approval_required',
    requestId: approval.requestId,
    tool,
    args,
    policy: permission.policy,
    message:
      `Tool "${tool}" membutuhkan approval ` +
      `(${permission.policy.label}).`,
  };
}



  const input = buildSkillInput(tool, args);

  try {
    const result = await runSkillByName(
      tool,
      input,
      ctx
    );

    return {
      status: 'executed',
      tool,
      args,
      result,
    };
  } catch (error) {
    return {
      status: 'error',
      tool,
      args,
      message: error.message,
    };
  }
}

async function executeApprovedRequest(requestId, userId, ctx = {}) {
  const {
    consumeApproval,
  } = require('./approval');

  const consumed = consumeApproval(
    requestId,
    userId
  );

  if (!consumed.success) {
    return {
      status: 'error',
      message: consumed.reason,
    };
  }

  const request = consumed.request;

  const input = buildSkillInput(
    request.tool,
    request.args
  );

  try {
    const result = await runSkillByName(
      request.tool,
      input,
      {
        ...ctx,
        userId,
      }
    );

    return {
      status: 'executed',
      requestId,
      tool: request.tool,
      args: request.args,
      result,
      continuation:request.continuation,
    };
  } catch (error) {
    return {
      status: 'error',
      requestId,
      tool: request.tool,
      args: request.args,
      message: error.message,
    };
  }
}

/**
 * Parse and validate a decision returned by the LLM.
 *
 * Supported decisions:
 *
 * {
 *   "action": "answer",
 *   "content": "..."
 * }
 *
 * OR
 *
 * {
 *   "action": "tool",
 *   "tool": "ping",
 *   "args": {
 *     "host": "8.8.8.8"
 *   }
 * }
 */

function parseAgentDecision(raw) {
  if (typeof raw !== 'string') {
    return {
      valid: false,
      reason: 'Response LLM harus berupa string.',
    };
  }

  let text = raw.trim();

  // Remove markdown JSON code fence.
  text = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Try to extract the first JSON object if the model
  // added explanatory text around it.
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  let decision;

  try {
    decision = JSON.parse(text);
  } catch (error) {
    return {
      valid: false,
      reason: 'Response LLM bukan JSON yang valid.',
      raw,
    };
  }

  if (!decision || typeof decision !== 'object') {
    return {
      valid: false,
      reason: 'Decision harus berupa object.',
      raw,
    };
  }

  // Normalize common LLM tool format:
  // {"action":"shell","command":"pwd"}
  // -> {"action":"tool","tool":"shell","args":{"command":"pwd"}}
  if (
    decision.action === 'shell' &&
    typeof decision.command === 'string'
  ) {
    decision = {
      action: 'tool',
      tool: 'shell',
      args: {
        command: decision.command,
      },
    };
  }

  if (
    decision.action !== 'answer' &&
    decision.action !== 'tool'
  ) {
    return {
      valid: false,
      reason: 'Action harus "answer" atau "tool".',
      raw,
    };
  }

  if (decision.action === 'answer') {
    if (
      typeof decision.content !== 'string' ||
      !decision.content.trim()
    ) {
      return {
        valid: false,
        reason: 'Answer harus memiliki content.',
        raw,
      };
    }

    return {
      valid: true,
      decision: {
        action: 'answer',
        content: decision.content.trim(),
      },
    };
  }

  // Tool decision
  const toolValidation = validateToolAction(decision);

  if (!toolValidation.valid) {
    return {
      valid: false,
      reason: toolValidation.reason,
      raw,
    };
  }

  return {
    valid: true,
    decision: {
      action: 'tool',
      tool: decision.tool,
      args: decision.args || {},
    },
  };
}

async function handleAgentDecision(raw, ctx) {
  const parsed = parseAgentDecision(raw);

  if (!parsed.valid) {
    return {
      status: 'error',
      message: parsed.reason,
      raw: parsed.raw || raw,
    };
  }

  if (parsed.decision.action === 'answer') {
    return {
      status: 'answered',
      content: parsed.decision.content,
    };
  }

  if (parsed.decision.action === 'tool') {
    return await executeAgentTool(
      parsed.decision,
      ctx
    );
  }

  return {
    status: 'error',
    message: 'Action tidak dikenali.',
  };
}

function buildAgentPrompt() {
  const tools = buildToolManifest();

  const toolList = tools.length
    ? tools
        .map((tool) => {
          const schema = TOOL_ARG_SCHEMAS[tool.name];

          if (!schema) {
            return `- ${tool.name}: ${tool.description}`;
          }

          const args = Object.entries(schema.types)
            .map(
              ([name, type]) =>
                `${name}: ${type}`
            )
            .join(', ');

          return [
            `- ${tool.name}: ${tool.description}`,
            `  Arguments: { ${args} }`,
            `  Required: ${schema.required.join(', ')}`,
          ].join('\n');
        })
        .join('\n')
    : '- Tidak ada tool yang tersedia.';

  return [
    'Kamu adalah AI agent bernama Paijo.',
    '',
    'Tugasmu adalah membantu user dengan memilih apakah kamu:',
    '1. Menjawab langsung, atau',
    '2. Menggunakan tool yang tersedia.',
    '',
    'ATURAN OUTPUT:',
    'Output HARUS berupa JSON valid.',
    'Jangan gunakan markdown.',
    'Jangan tambahkan penjelasan di luar JSON.',
    '',
    'Jika bisa menjawab tanpa tool:',
    '{"action":"answer","content":"jawaban kamu"}',
    '',
    'Jika membutuhkan tool:',
    '{"action":"tool","tool":"nama_tool","args":{}}',
    '',
    'TOOLS YANG TERSEDIA:',
    toolList,
    '',
    'Pilih tool hanya jika memang diperlukan.',
    'Jangan mengarang nama tool.',
    'Gunakan argument yang sesuai dengan kebutuhan tool.',
    '',
    'ATURAN SHELL:',
    'Satu action shell hanya boleh menjalankan satu command sederhana.',
    'Jangan menggunakan &&, ||, ;, |, >, <, backtick, $(), atau command chaining lainnya.',
    'Jika user meminta beberapa command shell, pecah menjadi beberapa action shell secara berurutan.',
    'Contoh: "Jalankan pwd, lalu setelah itu jalankan date" harus menjadi shell {"command":"pwd"} terlebih dahulu.',
    'Setelah hasil pwd diterima, barulah keluarkan shell {"command":"date"}.',
    'Jangan pernah menggabungkan beberapa command menjadi "pwd && date".',
  ].join('\n');
}

async function askAgent(userText, config, history = []) {
  const systemPrompt = buildAgentPrompt();

  const messages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    ...history,
    {
      role: 'user',
      content: userText,
    },
  ];

  const raw = await callLLM(messages, config);

  return {
    raw,
    parsed: parseAgentDecision(raw),
  };
}

async function runAgent(userText, config, history = [], ctx = {}) {
  const messages = [
    {
      role: 'system',
      content: buildAgentPrompt(),
    },
    ...history,
    {
      role: 'user',
      content: userText,
    },
  ];

  const MAX_STEPS = 5;

  for (let step = 1; step <= MAX_STEPS; step++) {
    console.log(`[agent] Step ${step}/${MAX_STEPS}`);

    const raw = await callLLM(messages, config);
    const parsed = parseAgentDecision(raw);

    if (!parsed.valid) {
      return {
        status: 'error',
        message: parsed.reason,
        raw,
      };
    }

    if (parsed.decision.action === 'answer') {
      return {
        status: 'answered',
        content: parsed.decision.content,
        steps: step,
      };
    }

    const toolDecision = parsed.decision;

    console.log(
      `[agent] Tool requested: ${toolDecision.tool}`
    );

    const execution = await executeAgentTool(
      toolDecision,
      {
        ...ctx,
        userText,
      }
    );

    if (execution.status === 'approval_required') {
      return execution;
    }

    if (execution.status === 'error') {
      return execution;
    }

    messages.push({
      role: 'assistant',
      content: raw,
    });

    messages.push({
      role: 'user',
      content: [
        `Tool "${execution.tool}" selesai dijalankan.`,
        '',
        'Hasil tool:',
        JSON.stringify(execution.result),
        '',
        'Gunakan hasil tersebut untuk melanjutkan.',
        'Jika masih membutuhkan tool, keluarkan JSON action tool.',
        'Jika sudah cukup, keluarkan JSON action answer.',
      ].join('\n'),
    });
  }

  return {
    status: 'error',
    message: `Agent mencapai batas maksimum ${MAX_STEPS} step.`,
  };
}

async function continueAgentAfterApproval(
  execution,
  config,
  ctx = {}
) {
  const MAX_CONTINUATION_STEPS = 5;

  if (!execution || execution.status !== 'executed') {
    return {
      status: 'error',
      message: 'Execution result tidak valid untuk continuation.',
    };
  }

  const continuation = execution.continuation;

  if (!continuation || !continuation.userText) {
    return {
      status: 'error',
      message: 'Continuation context tidak ditemukan.',
    };
  }

  let history = Array.isArray(continuation.history)
    ? continuation.history.slice()
    : [];

  let step = Number.isInteger(continuation.step)
    ? continuation.step
    : 0;

  let currentExecution = execution;

  while (true) {
    step++;

    history.push({
      tool: currentExecution.tool,
      args: currentExecution.args,
      result: currentExecution.result,
    });

    if (step > MAX_CONTINUATION_STEPS) {
      return {
        status: 'error',
        message:
          `Agent continuation mencapai batas maksimum ` +
          `${MAX_CONTINUATION_STEPS} step.`,
      };
    }

    const messages = [
      {
        role: 'system',
        content: buildAgentPrompt(),
      },
      {
        role: 'user',
        content: continuation.userText,
      },
    ];

    for (const item of history) {
      messages.push({
        role: 'assistant',
        content: JSON.stringify({
          action: 'tool',
          tool: item.tool,
          args: item.args,
        }),
      });

      messages.push({
        role: 'user',
        content: [
          `Tool "${item.tool}" selesai dijalankan.`,
          '',
          'Hasil tool:',
          JSON.stringify(item.result),
        ].join('\n'),
      });
    }

    messages.push({
      role: 'user',
      content: [
        'Lanjutkan request user berdasarkan seluruh history tool.',
        'Jangan mengulang tool yang sudah berhasil dijalankan.',
        'Jika masih membutuhkan tool, keluarkan JSON action tool.',
        'Jika semua task sudah selesai, keluarkan JSON action answer.',
      ].join('\n'),
    });

    const raw = await callLLM(messages, config);
    const parsed = parseAgentDecision(raw);

    if (!parsed.valid) {
      return {
        status: 'error',
        message: parsed.reason,
        raw,
      };
    }

    const decision = parsed.decision;

    if (decision.action === 'answer') {
      return {
        status: 'answered',
        answer: decision.content,
      };
    }

    const lastItem = history[history.length - 1];

    const duplicate =
      lastItem &&
      decision.action === 'tool' &&
      decision.tool === lastItem.tool &&
      JSON.stringify(decision.args || {}) ===
        JSON.stringify(lastItem.args || {});

    if (duplicate) {
      return {
        status: 'error',
        message:
          `Agent mencoba mengulang tool "${decision.tool}" ` +
          'dengan argument yang sama.',
      };
    }

    const nextExecution = await executeAgentTool(
      decision,
      {
        ...ctx,
        userText: continuation.userText,
        continuationHistory: history,
        continuationStep: step,
      }
    );

    if (nextExecution.status === 'approval_required') {
      return nextExecution;
    }

    if (nextExecution.status === 'error') {
      return nextExecution;
    }

    currentExecution = nextExecution;
  }
}

module.exports = {
  buildToolManifest,
  buildAgentPrompt,
  validateToolAction,
  buildSkillInput,
  executeAgentTool,
  executeApprovedRequest,
  parseAgentDecision,
  handleAgentDecision,
  continueAgentAfterApproval,
  runAgent,
  askAgent,
  runAgent,
};
