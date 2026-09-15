const TOOL_RISK = {
  low: {
    level: 0,
    label: 'LOW',
  },

  medium: {
    level: 1,
    label: 'MEDIUM',
  },

  high: {
    level: 2,
    label: 'HIGH',
  },
};

const TOOL_POLICY = {
  ping: 'low',
  remember: 'low',
  'clawd-scan': 'low',

  fetch: 'medium',
  'device-info': 'medium',
  readfile: 'medium',

  writefile: 'high',
  shell: 'high',
  addskill: 'high',
  delskills: 'high',
};

function getToolRisk(toolName) {
  return TOOL_POLICY[toolName] || 'high';
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
