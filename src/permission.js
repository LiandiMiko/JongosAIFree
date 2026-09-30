const { getToolPolicy, getToolRisk } = require('./tool-policy');

/**
 * Extract canonical tool name from a tool-call string or raw name.
 * Examples:
 *   "obsidian-read: note.md" → "obsidian-read"
 *   "shell: ls -la"          → "shell"
 *   "ping 8.8.8.8"           → "ping"
 *   "device-info"             → "device-info"
 */
function extractToolName(input) {
  const s = String(input || '').trim();
  if (!s) return '';

  // "tool: rest" form
  const colon = s.match(/^([a-z0-9-]+)\s*:/i);
  if (colon) return colon[1].toLowerCase();

  // "tool rest" form (ping, readfile, writefile)
  const space = s.match(/^([a-z0-9-]+)(?:\s|$)/i);
  if (space) return space[1].toLowerCase();

  return s.toLowerCase();
}

/**
 * Permission check.
 *
 * LOW / MEDIUM → auto-allow (medium is informational risk only)
 * HIGH         → requiresApproval (but still "allowed" for the approval flow)
 *
 * Security denylist can block entirely (allowed: false).
 */
function checkPermission(toolInput) {
  const toolName = extractToolName(toolInput);
  const policy = getToolPolicy(toolName);

  // Hard denylist patterns (path traversal, destructive shell, etc.)
  const raw = String(toolInput || '');
  const blockedPatterns = [
    /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?\/\b/i,  // rm -rf /
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\b:\(\)\s*\{/,  // fork bomb
    /\.\.\//,        // path traversal in sensitive context handled per-skill too
  ];

  for (const re of blockedPatterns) {
    if (re.test(raw) && toolName === 'shell') {
      return {
        allowed: false,
        requiresApproval: false,
        policy,
        reason: 'Command diblokir oleh security policy (perintah berbahaya).',
      };
    }
  }

  if (policy.risk === 'high') {
    return {
      allowed: true, // allowed to proceed into approval flow
      requiresApproval: true,
      policy,
      reason: 'High-risk tool requires user approval.',
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    policy,
    reason: `${policy.label}-risk tool can execute automatically.`,
  };
}

module.exports = {
  checkPermission,
  extractToolName,
};
