#!/usr/bin/env node
/**
 * JongosAIFree — Interactive Setup
 * Cross-platform: Windows / Linux / macOS / Termux
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const CONFIG_PATH = path.join(ROOT, 'config.json');
const ENV_PATH = path.join(ROOT, '.env');

const isWindows = process.platform === 'win32';
const isTermux = process.env.PREFIX && process.env.PREFIX.includes('com.termux');

// ============ Helper ============

function c(str, code) {
  if (isWindows && !process.env.WT_SESSION) return str; // Windows CMD lama
  return `\x1b[${code}m${str}\x1b[0m`;
}
const bold = (s) => c(s, '1');
const cyan = (s) => c(s, '36');
const green = (s) => c(s, '32');
const yellow = (s) => c(s, '33');
const red = (s) => c(s, '31');
const gray = (s) => c(s, '90');

function banner() {
  console.log('');
  console.log(cyan(bold('  ╔══════════════════════════════════╗')));
  console.log(cyan(bold('  ║     🦞 JONGOS AI FREE SETUP 🦞     ║')));
  console.log(cyan(bold('  ╚══════════════════════════════════╝')));
  console.log('');
  console.log(gray(`  Platform: ${process.platform} ${os.arch()} • Node ${process.version}`));
  console.log('');
}

function section(title) {
  console.log('');
  console.log(yellow('  ── ' + title + ' ' + '─'.repeat(Math.max(0, 40 - title.length))));
  console.log('');
}

function info(msg) { console.log('  ' + gray('•') + ' ' + msg); }
function ok(msg)   { console.log('  ' + green('✓') + ' ' + msg); }
function warn(msg) { console.log('  ' + yellow('!') + ' ' + msg); }
function err(msg)  { console.log('  ' + red('✗') + ' ' + msg); }

// ============ Defaults per platform ============

function defaultVaultPath() {
  if (isTermux) {
    return '/storage/emulated/0/Documents/second-brain';
  }
  if (isWindows) {
    return path.join(os.homedir(), 'Documents', 'second-brain');
  }
  return path.join(os.homedir(), 'Documents', 'second-brain');
}

function defaultDataDir() {
  return path.join(ROOT, 'data');
}

// ============ Prompt ============

async function ask(questions) {
  // Coba pakai enquirer kalau ada, fallback ke readline
  try {
    const { prompt } = require('enquirer');
    return await prompt(questions);
  } catch {
    return await fallbackPrompt(questions);
  }
}

function fallbackPrompt(questions) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const askOne = (q) => new Promise((resolve) => {
    const def = q.initial != null ? ` [${q.initial}]` : '';
    rl.question(`  ${q.message}${def}: `, (ans) => {
      const val = ans.trim() || q.initial || '';
      if (q.validate) {
        const r = q.validate(val);
        if (r !== true) {
          console.log('    ' + r);
          return resolve(askOne(q));
        }
      }
      resolve(q.result ? q.result(val) : val);
    });
  });

  return (async () => {
    const out = {};
    for (const q of questions) {
      out[q.name] = await askOne(q);
    }
    rl.close();
    return out;
  })();
}

// ============ Save ============

function writeEnv(vars) {
  const lines = [];
  lines.push('# === AI Providers ===');
  if (vars.groq) lines.push(`GROQ_API_KEY=${vars.groq}`);
  if (vars.gemini) lines.push(`GEMINI_API_KEY_1=${vars.gemini}`);
  if (vars.openrouter) lines.push(`OPENROUTER_API_KEY=${vars.openrouter}`);
  if (vars.mistral) lines.push(`MISTRAL_API_KEY=${vars.mistral}`);
  if (vars.sambanova) lines.push(`SAMBANOVA_API_KEY=${vars.sambanova}`);
  lines.push(`LLM7_API_KEY=${vars.llm7 || 'unused'}`);

  lines.push('');
  lines.push('# === Local LLM (opsional) ===');
  lines.push(`LLAMACPP_URL=${vars.llamacppUrl || 'http://127.0.0.1:8080/v1'}`);
  lines.push(`LLAMACPP_API_KEY=${vars.llamacppKey || 'local'}`);

  lines.push('');
  lines.push('# === Obsidian Vault (opsional) ===');
  lines.push(`OBSIDIAN_VAULT=${vars.vault || ''}`);

  lines.push('');
  fs.writeFileSync(ENV_PATH, lines.join('\n'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

// ============ Main ============

async function main() {
  banner();

  // Cek Node version
  const nodeVer = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeVer < 18) {
    err(`Node.js v18+ required (you have v${process.versions.node})`);
    process.exit(1);
  }
  ok(`Node.js v${process.versions.node}`);

  if (isTermux) {
    info('Termux detected — device skills (battery, camera, GPS) akan aktif.');
  }

  section('Agent Configuration');

  const basic = await ask([
    {
      type: 'input',
      name: 'agentName',
      message: 'Nama agent',
      initial: 'Paijo',
    },
    {
      type: 'input',
      name: 'webPort',
      message: 'Web UI port',
      initial: '3000',
      result: (v) => parseInt(v, 10) || 3000,
    },
  ]);

  section('AI Providers (isi yang kamu punya, sisanya Enter aja)');

  const providers = await ask([
    {
      type: 'password',
      name: 'groq',
      message: 'Groq API key      (paling cepat, gratis)',
      initial: '',
    },
    {
      type: 'password',
      name: 'gemini',
      message: 'Gemini API key    (gratis 20/hari)',
      initial: '',
    },
    {
      type: 'password',
      name: 'openrouter',
      message: 'OpenRouter key    (banyak model free)',
      initial: '',
    },
    {
      type: 'password',
      name: 'mistral',
      message: 'Mistral key       (gratis tier)',
      initial: '',
    },
    {
      type: 'password',
      name: 'sambanova',
      message: 'SambaNova key     (opsional)',
      initial: '',
    },
  ]);

  section('Local LLM (opsional — Enter kalau nggak punya)');

  const local = await ask([
    {
      type: 'input',
      name: 'llamacppUrl',
      message: 'llama.cpp URL',
      initial: 'http://127.0.0.1:8080/v1',
    },
    {
      type: 'password',
      name: 'llamacppKey',
      message: 'llama.cpp API key',
      initial: 'local',
    },
  ]);

  section('Obsidian Vault (opsional — Enter untuk skip)');

  const vaultPath = await ask([
    {
      type: 'input',
      name: 'vault',
      message: 'Path vault Obsidian',
      initial: '',
    },
  ]);

  // Validasi vault kalau diisi
  let vaultFinal = '';
  if (vaultPath.vault && vaultPath.vault.trim()) {
    const vp = vaultPath.vault.trim();
    if (fs.existsSync(vp)) {
      ok(`Vault ditemukan: ${vp}`);
      const mdCount = countMarkdown(vp);
      info(`${mdCount} file .md`);
      vaultFinal = vp;
    } else {
      warn(`Path tidak ditemukan: ${vp}`);
      warn('Obsidian skills akan di-disable sampai path valid.');
      vaultFinal = vp; // simpan aja, user mungkin mau setup manual nanti
    }
  } else {
    info('Vault di-skip. Obsidian skills akan di-disable.');
  }

  section('Telegram (opsional)');

  const tg = await ask([
    {
      type: 'password',
      name: 'telegramToken',
      message: 'Telegram bot token (dari @BotFather)',
      initial: '',
    },
  ]);

  // Pilih provider utama
  const available = ['groq', 'gemini', 'openrouter', 'mistral', 'sambanova']
    .filter((k) => providers[k] && providers[k].trim());

  let defaultProvider = available[0] || 'gemini';
  let defaultModel = 'llama-3.3-70b-versatile';

  if (available.length > 0) {
    section('Provider utama');
    info(`Tersedia: ${available.join(', ')}`);

    const pick = await ask([
      {
        type: 'input',
        name: 'provider',
        message: 'Provider utama',
        initial: defaultProvider,
        validate: (v) => {
          if (!v || !v.trim()) return true;
          return available.includes(v.trim()) || `Pilih salah satu: ${available.join(', ')}`;
        },
      },
    ]);
    defaultProvider = (pick.provider || defaultProvider).trim();

    // Model default per provider
    const modelDefaults = {
      groq: 'llama-3.3-70b-versatile',
      gemini: 'gemini-2.0-flash',
      openrouter: 'qwen/qwen3.8-27b:free',
      mistral: 'mistral-small-latest',
      sambanova: 'Meta-Llama-3.3-70B-Instruct',
    };
    defaultModel = modelDefaults[defaultProvider] || defaultModel;

    const pickModel = await ask([
      {
        type: 'input',
        name: 'model',
        message: 'Model',
        initial: defaultModel,
      },
    ]);
    if (pickModel.model && pickModel.model.trim()) {
      defaultModel = pickModel.model.trim();
    }
  } else {
    warn('Tidak ada provider yang di-konfigurasi.');
    warn('Kamu harus isi minimal 1 provider di .env sebelum start.');
    defaultProvider = 'gemini';
    defaultModel = 'gemini-2.0-flash';
  }

  // === Simpan ===
  section('Menyimpan');

  writeEnv({
    ...providers,
    ...local,
    vault: vaultFinal,
  });
  ok('.env dibuat');

  const cfg = {
    agentName: basic.agentName || 'Paijo',
    provider: defaultProvider,
    model: defaultModel,
    webPort: basic.webPort || 3000,
  };
  if (tg.telegramToken && tg.telegramToken.trim()) {
    cfg.telegramToken = tg.telegramToken.trim();
  }
  writeConfig(cfg);
  ok('config.json dibuat');

  // Data dir
  const dataDir = path.join(ROOT, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'imports', 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'imports', 'processed'), { recursive: true });
  ok('data/ siap');

  // === Print next steps ===
  section('Selesai!');

  console.log('  ' + green('✓ Setup complete.') + ' ' + gray('Next:'));
  console.log('');
  console.log('    ' + cyan('npm start') + '                    ' + gray('# Start agent'));
  console.log('    ' + cyan(`http://localhost:${cfg.webPort}`) + '          ' + gray('# Chat UI'));
  console.log('    ' + cyan(`http://localhost:${cfg.webPort}/dashboard`) + '  ' + gray('# Dashboard'));
  console.log('');

  if (isTermux) {
    console.log('  ' + gray('Termux tips:'));
    console.log('    ' + cyan('termux-wake-lock') + '                   ' + gray('# Cegah Android matiin proses'));
    console.log('    ' + cyan('tmux new -s jongos "npm start"') + '      ' + gray('# Biar survive terminal close'));
    console.log('');
  }

  if (cfg.telegramToken) {
    console.log('  ' + gray('Telegram:'));
    console.log('    Kirim ' + cyan('/start') + ' ke bot kamu.');
    console.log('');
  }

  console.log('  ' + gray('Repo: ') + cyan('https://github.com/LiandiMiko/JongosAIFree'));
  console.log('');
}

function countMarkdown(dir) {
  let n = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (e.isDirectory()) n += countMarkdown(path.join(dir, e.name));
      else if (e.name.endsWith('.md')) n++;
    }
  } catch {}
  return n;
}

main().catch((err) => {
  if (err.code === 'ERR_USE_AFTER_CLOSE') {
    console.log('\n  Setup dibatalkan.\n');
    process.exit(0);
  }
  console.error('\n  Setup error:', err.message);
  process.exit(1);
});
