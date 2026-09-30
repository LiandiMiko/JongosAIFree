/**
 * Agent facade — single entry point used by Telegram & WebUI.
 * Bridges the modular agent (src/agent/) with the approval system.
 */
const { runAgentLoop } = require('./agent/loop');
const { executeApprovedTool } = require('./agent/tool-executor');
const {
  approveRequest,
  denyRequest,
  consumeApproval,
  getApproval,
} = require('./approval');
const { addMessage } = require('./memory');

/**
 * Run the multi-step agent.
 * @param {string} text - user message
 * @param {object} config
 * @param {object} meta - { userId, source, ... }
 * @returns structured result for telegram/webui
 */
async function runAgent(text, config = {}, meta = {}) {
  const userId = meta.userId || 'anonymous';

  try {
    const result = await runAgentLoop(text, config, {
      ...meta,
      userId,
      source: meta.source || 'telegram',
    });

    // Persist conversation on final answer
    if (result.status === 'answered') {
      try {
        await addMessage(userId, 'user', text);
        await addMessage(userId, 'assistant', result.answer);
      } catch (e) {
        console.log('[agent-loop] memory save skipped:', e.message);
      }
    }

    return result;
  } catch (err) {
    console.error('[agent-loop] runAgent error:', err.message);
    return {
      status: 'error',
      message: `Terjadi kesalahan: ${err.message}`,
    };
  }
}

/**
 * After user clicks Allow on Telegram:
 * 1. Mark approval as approved
 * 2. Consume it
 * 3. Execute the tool
 */
async function executeApprovedRequest(requestId, userId, meta = {}) {
  // Idempotent: if still pending, approve first; if already approved (by telegram pre-check), continue
  const existing = getApproval(requestId);
  if (!existing) {
    return {
      status: 'error',
      message: 'Approval request tidak ditemukan atau sudah expired.',
    };
  }

  if (existing.status === 'pending') {
    const approval = approveRequest(requestId, userId);
    if (!approval.success) {
      return {
        status: 'error',
        message: approval.reason || 'Approval gagal.',
      };
    }
  } else if (existing.status !== 'approved') {
    return {
      status: 'error',
      message: `Request berstatus "${existing.status}", tidak bisa dieksekusi.`,
    };
  }

  const consumed = consumeApproval(requestId, userId);
  if (!consumed.success) {
    return {
      status: 'error',
      message: consumed.reason || 'Gagal consume approval.',
    };
  }

  const request = consumed.request;
  const execResult = await executeApprovedTool(request, {
    ...meta,
    userId,
    config: meta.config || {},
    source: 'approval',
  });

  return execResult;
}

/**
 * Continue the agent loop after a tool was approved & executed.
 */
async function continueAgentAfterApproval(execResult, config = {}, meta = {}) {
  if (!execResult || execResult.status !== 'executed') {
    return {
      status: 'error',
      message: execResult?.message || execResult?.error || 'Tool execution gagal.',
    };
  }

  const request = execResult.request;
  const continuation = (request && request.continuation) || {};
  const userId = meta.userId || request.userId || 'anonymous';

  // Re-enter the agent loop with the tool result injected
  const result = await runAgentLoop(
    continuation.userText || `Lanjutkan setelah tool ${execResult.tool}`,
    config,
    {
      userId,
      source: meta.source || 'approval',
      history: continuation.history || [],
      step: continuation.step || 0,
      toolsUsed: continuation.toolsUsed || [execResult.tool],
      toolResult: {
        tool: execResult.tool,
        output: execResult.output,
      },
    }
  );

  if (result.status === 'answered') {
    try {
      await addMessage(userId, 'assistant', result.answer);
    } catch (e) {
      console.log('[agent-loop] memory save skipped:', e.message);
    }
  }

  return result;
}

/**
 * Simple processMessage for WebUI / backward compat.
 * Returns a plain string reply.
 */
async function processMessage(userId, text, config) {
  const result = await runAgent(text, config, {
    userId,
    source: 'webui',
  });

  if (result.status === 'answered') {
    return result.answer;
  }
  if (result.status === 'approval_required') {
    return (
      `🔐 Tool high-risk membutuhkan approval.\n\n` +
      `Tool: ${result.tool}\n` +
      `Risk: ${result.policy?.label || 'HIGH'}\n` +
      `ID: ${result.requestId}\n\n` +
      `Gunakan Telegram bot untuk approve, atau jalankan ulang dari chat yang mendukung approval.`
    );
  }
  return result.message || 'Terjadi kesalahan.';
}

module.exports = {
  runAgent,
  executeApprovedRequest,
  continueAgentAfterApproval,
  processMessage,
  // re-export deny for telegram
  denyRequest,
  getApproval,
};
