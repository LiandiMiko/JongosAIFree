#!/usr/bin/env node
const readline = require('readline');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const configPath = path.join(ROOT, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('config.json tidak ditemukan. Jalankan "npm run setup" dulu.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const { runAgent, executeApprovedRequest, continueAgentAfterApproval } = require('./agent-loop');
const { approveRequest, denyRequest } = require('./approval'); // BUG FIX 1: Tambah approveRequest
const { getHistory, clearHistory } = require('./memory');

const c = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m', blue: '\x1b[34m',
};

const agentName = config.agentName || 'Paijo';
const userId = `tui-${process.env.USER || 'local'}`;

let rl;

function ask(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (ans) => resolve(ans));
  });
}

function banner() {
  console.log('');
  console.log(c.cyan + c.bright + '  ╔════════════════════════════════════════════╗' + c.reset);
  console.log(c.cyan + c.bright + '  ║  🦞  ' + (agentName.toUpperCase()).padEnd(37) + '║' + c.reset);
  console.log(c.cyan + c.bright + '  ║      Terminal Chat                         ║' + c.reset);
  console.log(c.cyan + c.bright + '  ╚════════════════════════════════════════════╝' + c.reset);
  console.log('');
  console.log(c.dim + `  Provider : ${config.provider || '?'} | Model: ${config.model || '?'}` + c.reset);
  console.log(c.dim + '  /help  /reset  /status  /clear  /quit' + c.reset);
  console.log('');
}

function showAgent(text) {
  const lines = String(text).split('\n');
  console.log('');
  console.log(c.cyan + c.bright + '  ◂ ' + agentName + ':' + c.reset);
  for (const line of lines) {
    console.log(c.dim + '  │ ' + c.reset + line);
  }
  console.log('');
}

function showInfo(text) {
  console.log(c.yellow + '  ℹ ' + c.reset + text);
}

function showError(text) {
  console.log(c.red + '  ✗ ' + c.reset + text);
}

function startSpinner() {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  return setInterval(() => {
    process.stdout.write('\r' + c.dim + '  ' + frames[i++ % frames.length] + ' ' + agentName + ' sedang berpikir...' + c.reset + '\x1b[K');
  }, 80);
}

function stopSpinner(t) {
  if (!t) return;
  clearInterval(t);
  process.stdout.write('\r\x1b[K');
}

async function askApproval(result) {
  // BUG FIX 2: Spinner sudah distop di processAgent sebelum manggil fungsi ini
  console.log('');
  console.log(c.yellow + c.bright + '  ⚠  APPROVAL REQUIRED' + c.reset);
  console.log(c.dim + '  Tool : ' + c.reset + result.tool);
  console.log(c.dim + '  Risk : ' + c.reset + (result.policy?.label || 'HIGH'));
  const argsStr = JSON.stringify(result.args || {}).slice(0, 180);
  console.log(c.dim + '  Args : ' + c.reset + argsStr);
  const ans = await ask(c.yellow + '  Allow? (y/N) › ' + c.reset);
  if (ans == null) return false;
  return ans.trim().toLowerCase() === 'y';
}

async function processAgent(userText) {
  let result;
  let t = startSpinner();
  
  try {
    result = await runAgent(userText, config, [], { userId });
  } finally {
    stopSpinner(t);
  }

  let steps = 0;
  const MAX = 5;

  while (result && result.status === 'approval_required' && steps < MAX) {
    steps++;
    
    // Tampilkan approval tanpa spinner
    const allowed = await askApproval(result);

    if (!allowed) {
      denyRequest(result.requestId, userId);
      return { status: 'denied' };
    }

    // Panggil approveRequest
    const appRes = approveRequest(result.requestId, userId);
    if (!appRes.success) {
      return { status: 'error', message: appRes.reason };
    }

    t = startSpinner();
    let exec;
    try {
      exec = await executeApprovedRequest(result.requestId, userId, { userText });
    } finally {
      stopSpinner(t);
    }

    if (!exec || exec.status !== 'executed') {
      return { status: 'error', message: exec?.message || 'Eksekusi gagal' };
    }

    showInfo(`✓ ${exec.tool} selesai`);

    t = startSpinner();
    try {
      const cont = await continueAgentAfterApproval(exec, config, { userId });
      if (cont && cont.status) {
        result = cont;
        continue;
      }
    } catch (e) {
      return { status: 'answered', content: String(exec.result || '(tool selesai)') };
    } finally {
      stopSpinner(t);
    }
    return { status: 'answered', content: String(exec.result || '(tool selesai)') };
  }

  if (steps >= MAX) {
    return { status: 'error', message: 'Max approval steps tercapai' };
  }

  return result;
}

async function handleCommand(text) {
  const cmd = text.split(/\s+/)[0].toLowerCase();

  if (cmd === '/quit' || cmd === '/exit') return 'quit';
  if (cmd === '/clear') { console.clear(); banner(); return 'ok'; }

  if (cmd === '/help') {
    console.log('');
    showInfo('/quit     keluar');
    showInfo('/reset    hapus history');
    showInfo('/status   quota & status provider');
    showInfo('/clear    bersihkan layar');
    showInfo('/help     bantuan');
    console.log('');
    return 'ok';
  }

  if (cmd === '/reset') {
    await clearHistory(userId);
    showInfo('History dihapus.');
    console.log('');
    return 'ok';
  }

  if (cmd === '/status') {
    const { getAllProviderStatus } = require('./llm-status');
    const all = getAllProviderStatus();
    console.log('');
    if (!all.length) { showInfo('Belum ada data.'); return 'ok'; }
    for (const e of all) {
      const u = e.usage || {};
      if (!u.requests && e.status === 'unknown') continue;
      const key = e.keyId != null ? ` #${e.keyId}` : '';
      const color = e.status === 'available' ? c.green
                  : e.status === 'rate_limited' ? c.yellow
                  : c.red;
      console.log(`  ${c.bright}${e.provider}${key}${c.reset} ${c.dim}${e.model}${c.reset}`);
      console.log(`    ${color}${e.status}${c.reset}  ${u.requests} req  ${u.totalTokens} tok`);
    }
    console.log('');
    return 'ok';
  }

  showInfo(`Command tidak dikenal: ${cmd}. Coba /help`);
  return 'ok';
}

async function main() {
  banner();

  try {
    const h = await getHistory(userId);
    if (h.length) {
      showInfo(`${h.length} pesan history tersimpan. /reset untuk hapus.`);
      console.log('');
    }
  } catch {}

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on('SIGINT', () => {
    console.log('\n' + c.dim + '  Bye! 👋\n' + c.reset);
    process.exit(0);
  });

  while (true) {
    const input = await ask(c.green + c.bright + '  ▸ Kamu: ' + c.reset);
    if (input == null) break;

    const text = input.trim();
    if (!text) continue;

    if (text.startsWith('/')) {
      const r = await handleCommand(text);
      if (r === 'quit') break;
      continue;
    }

    let result;
    try {
      result = await processAgent(text);
    } catch (err) {
      result = { status: 'error', message: err.message };
    }

    if (result.status === 'answered') {
      showAgent(result.content || result.answer || '(kosong)');
    } else if (result.status === 'error') {
      showError(result.message || 'Error');
    } else if (result.status === 'denied') {
      showInfo('Dibatalkan.');
      console.log('');
    }
  }

  rl.close();
  console.log(c.dim + '\n  Bye! 👋\n' + c.reset);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
