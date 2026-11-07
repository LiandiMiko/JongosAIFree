const fs = require('fs');
const path = require('path');

const STATUS_FILE = path.join(__dirname, '..', 'data', 'llm-status.json');
const HEALTH_FILE = path.join(__dirname, '..', 'data', 'health-state.json');

// ANSI Colors
const c = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', cyan: '\x1b[36m', white: '\x1b[37m'
};

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return null; }
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function draw() {
  const statusData = readJson(STATUS_FILE) || {};
  const healthData = readJson(HEALTH_FILE) || { models: {}, lastGoodModel: null };
  
  const providers = Object.values(statusData).filter(p => p.usage && p.usage.requests > 0 || p.status !== 'unknown');
  
  // Clear screen & move cursor to top
  process.stdout.write('\x1Bc');

  const width = 65;
  const line = '─'.repeat(width);
  
  console.log(`${c.cyan}${c.bright}  🦞 JONGOS AI - LIVE TERMINAL MONITOR ${c.reset}`);
  console.log(`${c.dim}  ${line}${c.reset}`);
  
  // Health State Summary
  const lastGood = healthData.lastGoodModel ? `${healthData.lastGoodModel.provider}/${healthData.lastGoodModel.model}` : 'None';
  const cooldownCount = Object.keys(healthData.models || {}).length;
  
  console.log(`  ${c.bright}Last Good Model :${c.reset} ${c.green}${lastGood}${c.reset}`);
  console.log(`  ${c.bright}Model Cooldown  :${c.reset} ${cooldownCount} models`);
  console.log(`${c.dim}  ${line}${c.reset}`);

  if (providers.length === 0) {
    console.log(`  ${c.yellow}Belum ada request. Coba chat di Telegram/WebUI.${c.reset}`);
    return;
  }

  // Sort: available dulu
  const order = { available: 0, rate_limited: 1, error: 2, unknown: 3 };
  providers.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  for (const p of providers) {
    const isHealthy = p.status === 'available';
    const statusColor = isHealthy ? c.green : (p.status === 'rate_limited' ? c.yellow : c.red);
    const keyLabel = p.keyId != null ? ` #${p.keyId}` : '';
    
    // Provider Header
    console.log(`  ${c.bright}${p.provider}${keyLabel}${c.reset} ${c.dim}(${p.model})${c.reset}`);
    
    // Status
    console.log(`  ├─ Status    : ${statusColor}${p.status.toUpperCase()}${c.reset}`);
    
    // Usage
    const u = p.usage || { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    console.log(`  ├─ Requests  : ${u.requests.toLocaleString()} req`);
    console.log(`  ├─ Tokens    : ${u.totalTokens.toLocaleString()} total (${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out)`);
    
    // Error / Cooldown
    if (p.lastError) {
      console.log(`  └─ Error     : ${c.red}${p.lastError.slice(0, 50)}${c.reset}`);
    } else if (p.status === 'rate_limited' && p.retryAfter) {
      console.log(`  └─ Retry     : in ${formatTime(p.retryAfter * 1000)}`);
    } else {
      console.log(`  └─ OK`);
    }
    console.log('');
  }

  console.log(`${c.dim}  ${line}${c.reset}`);
  console.log(`  ${c.dim}Refreshing every 2s. Press Ctrl+C to exit.${c.reset}`);
}

// Draw immediately, then every 2 seconds
draw();
setInterval(draw, 2000);
