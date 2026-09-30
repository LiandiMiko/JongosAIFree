const crypto = require('crypto');

const pendingApprovals = new Map();
const approvalAudit = [];
const APPROVAL_TTL_MS = 5 * 60 * 1000;

function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj)) deepFreeze(value);
  }
  return obj;
}

function isExpired(request) {
  return Date.now() - request.createdAt > APPROVAL_TTL_MS;
}

function expireIfNeeded(request) {
  if (request.status === "pending" && isExpired(request)) {
    request.status = "expired";
    request.expiredAt = Date.now();
    audit(request, "expired");
    pendingApprovals.delete(request.requestId);
    return true;
  }
  return false;
}

function audit(request, event) {
  approvalAudit.push({
    event,
    timestamp: Date.now(),
    requestId: request.requestId,
    userId: request.userId,
    tool: request.tool,
  });
}

function createApproval(userId, tool, args, policy, context = {}) {
  const requestId = crypto.randomUUID();
 
  const request = {
  requestId,
  userId,
  tool,
  args: deepFreeze(structuredClone(args)),
  policy,

  continuation: deepFreeze(
    structuredClone({
      userText: context.userText || '',
      history: Array.isArray(context.history) ? context.history : [],
      step: Number.isInteger(context.step) ? context.step : 0,
      toolsUsed: Array.isArray(context.toolsUsed) ? context.toolsUsed : [],
      toolCallString: context.toolCallString || '',
      source: context.source || '',
      ragUsed: !!context.ragUsed,
    })
  ),

  status: 'pending',
  createdAt: Date.now(),
};
 
  pendingApprovals.set(requestId, request);
  audit(request, "created");

  return request;
}

function getApproval(requestId) {
  return pendingApprovals.get(requestId) || null;
}

function approveRequest(requestId, userId) {
  const request = pendingApprovals.get(requestId);

  if (!request) {
    return {
      success: false,
      reason: 'Approval request tidak ditemukan.',
    };
  }

  if (request.userId !== userId) {
    return {
      success: false,
      reason: 'Approval request bukan milik user ini.',
    };
  }

  if (expireIfNeeded(request)) {
    return {
      success: false,
      reason: 'Approval request sudah expired (lebih dari 5 menit).',
    };
  }

  if (request.status !== 'pending') {
    return {
      success: false,
      reason: `Request sudah berstatus "${request.status}".`,
    };
  }

  request.status = 'approved';
  request.approvedAt = Date.now();
  audit(request, "approved");

  return {
    success: true,
    request,
  };
}

function denyRequest(requestId, userId) {
  const request = pendingApprovals.get(requestId);

  if (!request) {
    return {
      success: false,
      reason: 'Approval request tidak ditemukan.',
    };
  }

  if (request.userId !== userId) {
    return {
      success: false,
      reason: 'Approval request bukan milik user ini.',
    };
  }

  if (request.status !== 'pending') {
    return {
      success: false,
      reason: `Request sudah berstatus "${request.status}".`,
    };
  }

  request.status = 'denied';
  request.deniedAt = Date.now();
  audit(request, "denied");

  return {
    success: true,
    request,
  };
}

function consumeApproval(requestId, userId) {
  const request = pendingApprovals.get(requestId);

  if (!request) {
    return {
      success: false,
      reason: 'Approval request tidak ditemukan.',
    };
  }

  if (request.userId !== userId) {
    return {
      success: false,
      reason: 'Approval request bukan milik user ini.',
    };
  }

  if (expireIfNeeded(request)) {
    return {
      success: false,
      reason: 'Approval request sudah expired (lebih dari 5 menit).',
    };
  }

  if (request.status !== 'approved') {
    return {
      success: false,
      reason: `Request belum approved. Status: "${request.status}".`,
    };
  }

  pendingApprovals.delete(requestId);
  audit(request, "consumed");

  return {
    success: true,
    request,
  };
}

function listApprovalAudit(userId) {
  return approvalAudit.filter(event => event.userId === userId);
}

function listPendingApprovals(userId) {
  return [...pendingApprovals.values()].filter(
    request =>
      request.userId === userId &&
      request.status === 'pending'
  );
}

module.exports = {
  createApproval,
  getApproval,
  approveRequest,
  denyRequest,
  consumeApproval,
  listPendingApprovals,
  listApprovalAudit,
};
