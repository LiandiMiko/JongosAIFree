const { getToolPolicy } = require('./tool-policy');

/**
 * Permission manager
 *
 * LOW    = auto allow
 * MEDIUM = ask user
 * HIGH   = ask user
 *
 * Later this module will be connected to Telegram
 * Allow / Deny buttons.
 */

function checkPermission(toolName) {
  const policy = getToolPolicy(toolName);

  if (policy.risk === 'low') {
    return {
      allowed: true,
      requiresApproval: false,
      policy,
      reason: 'Low-risk tool can execute automatically.',
    };
  }

  return {
    allowed: false,
    requiresApproval: true,
    policy,
    reason: `${policy.label}-risk tool requires user approval.`,
  };
}

module.exports = {
  checkPermission,
};
