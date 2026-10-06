const TOOL_RISK = Object.freeze({
  low: Object.freeze({
    level: 0,
    label: 'LOW',
  }),

  medium: Object.freeze({
    level: 1,
    label: 'MEDIUM',
  }),

  high: Object.freeze({
    level: 2,
    label: 'HIGH',
  }),
});

const TOOL_POLICY = Object.freeze({
  ping: 'low',
  remember: 'low',
  'clawd-scan': 'low',

  fetch: 'medium',
  'device-info': 'medium',
  readfile: 'medium',

  'obsidian-read': 'low',
  'obsidian-search': 'low',
  'obsidian-tree': 'low',
  'obsidian-tags': 'low',
  'obsidian-backlinks': 'low',
  'obsidian-context': 'low',
  'obsidian-normalize': 'medium',
  'obsidian-create': 'high',
  'obsidian-delete': 'high',
  'obsidian-move': 'high',
  'obsidian-organize': 'high',
  'obsidian-append': 'high',
  'obsidian-update': 'high',
  writefile: 'high',
  shell: 'high',
  addskill: 'high',
  delskills: 'high',
});

// FIX Q2: Normalize tool name to lowercase to prevent case-sensitivity escalation
function getToolRisk(toolName) {
  const key = String(toolName || '').toLowerCase().trim();
  return TOOL_POLICY[key] || 'high';
}

function getToolPolicy(toolName) {
  const risk = getToolRisk(toolName);

  return {
    tool: toolName,
    risk,
    level: TOOL_RISK[risk].level,
    label: TOOL_RISK[risk].label,
  };
}

function getAllToolPolicies() {
  return Object.entries(TOOL_POLICY).map(
    ([tool, risk]) => ({
      tool,
      risk,
      level: TOOL_RISK[risk].level,
      label: TOOL_RISK[risk].label,
    })
  );
}

module.exports = {
  TOOL_RISK,
  TOOL_POLICY,
  getToolRisk,
  getToolPolicy,
  getAllToolPolicies,
};

