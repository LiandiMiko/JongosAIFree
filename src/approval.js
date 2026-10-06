const crypto = require('crypto');

const pendingApprovals = new Map();
// FIX C12: Cap audit log at 1000 entries to prevent unbounded memory growth
const MAX_AUDIT_ENTRIES = 1000;
const approvalAudit = [];
const APPROVAL_TTL_MS = 5 * 60 * 1000;

// FIX Q12: deepFreeze with cycle detection to prevent stack overflow
function deepFreeze(obj, seen = new WeakSet()) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    if (seen.has(obj)) return obj;
    seen.add(obj);
    Object.freeze(obj);
    for (const value of Object.values(obj)) deepFreeze(value, seen);
  }
  return obj;
}

function isExpired(request) {
  return Date.now() - request.createdAt > APPROVAL_TTL_MS;
}

function expireIfNeeded(request) {
  if (request.status === 'pending' && isExpired(request)) {
    request.status = 'expired';
    request.expiredAt = Date.now();
    audit(request, 'expired');
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
  // FIX C12: Trim audit log to prevent unbounded memory growth
  if (approvalAudit.length > MAX_AUDIT_ENTRIES) {
    approvalAudit.shift();
  }
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
  audit(request, 'created');

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
  audit(request, 'approved');

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
  audit(request, 'denied');
  // FIX C11: Delete from pendingApprovals after deny to prevent memory leak
  pendingApprovals.delete(requestId);

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
  audit(request, 'consumed');

  return {
    success: true,
    request,
  };
}

function listApprovalAudit(userId) {
  return approvalAudit.filter((event) => event.userId === userId);
}

// FIX Q11: Filter out expired approvals from pending list.
// If userId is omitted, return all pending approvals (used by dashboard).
function listPendingApprovals(userId) {
  return [...pendingApprovals.values()].filter(
    (request) =>
      (!userId || request.userId === userId) &&
      request.status === 'pending' &&
      !isExpired(request)
  );
}


// FIX C12: Periodic sweep to clean up abandoned (timed-out) pending requests
setInterval(() => {
  const now = Date.now();
  for (const [id, req] of pendingApprovals.entries()) {
    if (req.status === 'pending' && now - req.createdAt > APPROVAL_TTL_MS) {
      req.status = 'expired';
      req.expiredAt = now;
      audit(req, 'expired');
      pendingApprovals.delete(id);
    }
  }
}, 60_000).unref(); // .unref() so this doesn't block Node.js exit

module.exports = {
  createApproval,
  getApproval,
  approveRequest,
  denyRequest,
  consumeApproval,
  listPendingApprovals,
  listApprovalAudit,
};
