#!/usr/bin/env node

/**
 * JongosAIFree CLI — Interactive terminal interface
 * Usage: node cli.js [command]
 *
 * Commands:
 *   (none)     Interactive menu
 *   onboard    First-time setup wizard
 *   start      Start the agent
 *   config     View/edit configuration
 *   status     Show agent status
 *   skills     List loaded skills
 *   reset      Reset all data
 *   help       Show help
 */

const fs = require('fs');
const path = require('path');
const { prompt } = require('enquirer');
const {
  c, red, green, yellow, blue, cyan, magenta, gray, bold, dim,
  banner, section, box, step, status, divider, spinner, nl, LOBSTER,
} = require('./src/ui');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const VERSION = '1.0.0';

// ─── Helpers ────────────────────────────────────────

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function isTermux() {
  return process.env.PREFIX === '/data/data/com.termux/files/usr' ||
    process.env.TERMUX_VERSION != null;
}

function maskKey(key) {
  if (!key || key.length < 12) return '(not set)';
  return key.slice(0, 6) + '••••' + key.slice(-4);
}

// ─── Onboarding ─────────────────────────────────────

async function onboard() {
  console.clear();
  banner();

  const platform = isTermux() ? 'Termux' : process.platform === 'win32' ? 'Windows' : process.platform;
  console.log(
    `  ${c.bold}Clawd Agent ${VERSION}${c.reset} ${gray(`— ${platform}`)}`
  );
  nl();

  // Security warning
  section('Security');
  box([
    `${c.yellow}Security notice — please read.${c.reset}`,
    '',
    'JongosAIFree connects to OpenRouter to process messages.',
    'Your API key is stored locally in config.json.',
    'Device access skills can read sensors, location, camera.',
    '',
    `${c.bold}Recommended:${c.reset}`,
    `${gray('–')} Keep your API key private`,
    `${gray('–')} Don't expose the Web UI to the public internet`,
    `${gray('–')} Review skills before installing third-party ones`,
    `${gray('–')} Use free models to avoid unexpected charges`,
  ]);
  nl();

  const { understood } = await prompt({
    type: 'confirm',
    name: 'understood',
    message: `${c.yellow}${c.bold}I understand. Continue?${c.reset}`,
    initial: true,
  });

  if (!understood) {
    console.log(`\n  ${red('Setup cancelled.')}\n`);
    process.exit(0);
  }

  // Check existing config
  const existing = loadConfig();
  let useExisting = false;

  if (existing) {
    section('Existing config detected');
    box([
      `${c.cyan}agent:${c.reset}    ${existing.agentName || 'Paijo'}`,
      `${c.cyan}model:${c.reset}    ${existing.model || '(not set)'}`,
      `${c.cyan}key:${c.reset}      ${maskKey(existing.openrouterKey)}`,
      `${c.cyan}telegram:${c.reset} ${existing.telegramToken ? 'configured' : 'not set'}`,
      `${c.cyan}port:${c.reset}     ${existing.webPort || 3000}`,
    ]);
    nl();

    const { handling } = await prompt({
      type: 'select',
      name: 'handling',
      message: `${c.green}${c.bold}Config handling${c.reset}`,
      choices: [
        { name: 'keep', message: 'Use existing values' },
        { name: 'edit', message: 'Edit existing config' },
        { name: 'fresh', message: 'Start fresh' },
      ],
    });

    if (handling === 'keep') {
      step('Config handling', 'Using existing values');
      useExisting = true;
    } else if (handling === 'fresh') {
      step('Config handling', 'Starting fresh');
    } else {
      step('Config handling', 'Editing existing config');
    }
  }

  let config = useExisting ? existing : {};

  if (!useExisting) {
    // Agent name
    section('Agent Identity');
    const { agentName } = await prompt({
      type: 'input',
      name: 'agentName',
      message: 'Agent name',
      initial: config.agentName || 'Paijo',
    });
    config.agentName = agentName;
    step('Agent name', agentName);

    // Model provider
    section('Model / API Provider');

    const FREE_MODELS = [
      { name: 'meta-llama/llama-3.3-70b-instruct:free', message: `${c.green}●${c.reset} Meta Llama 3.3 70B ${gray('(free, recommended)')}` },
      { name: 'deepseek/deepseek-r1-0528:free', message: `${c.green}●${c.reset} DeepSeek R1 ${gray('(free, reasoning)')}` },
      { name: 'google/gemma-3-27b-it:free', message: `${c.green}●${c.reset} Google Gemma 3 27B ${gray('(free, fast)')}` },
      { name: 'mistralai/mistral-small-3.1-24b-instruct:free', message: `${c.green}●${c.reset} Mistral Small 3.1 ${gray('(free)')}` },
      { name: 'qwen/qwen3-coder:free', message: `${c.green}●${c.reset} Qwen3 Coder 480B ${gray('(free, code)')}` },
      { name: 'nvidia/nemotron-3-nano-30b-a3b:free', message: `${c.green}●${c.reset} NVIDIA Nemotron Nano ${gray('(free)')}` },
      { name: 'llama-3.3-70b-versatile', message: `${c.green}●${c.reset} Llama 3.3 70B (Groq) ${gray('(free)')}` },
      { name: 'minimax/minimax-m2.5', message: `${c.yellow}●${c.reset} MiniMax M2.5 ${gray('(paid)')}` },
      { name: 'anthropic/claude-haiku-4-5', message: `${c.yellow}●${c.reset} Claude Haiku 4.5 ${gray('(paid, quality)')}` },
      { name: 'openrouter/auto', message: `${c.cyan}●${c.reset} Auto ${gray('(OpenRouter picks best)')}` },
      { name: 'custom', message: `${c.gray}●${c.reset} Custom model ID...` },
    ];

    const { modelChoice } = await prompt({
      type: 'select',
      name: 'modelChoice',
      message: `${c.green}${c.bold}Select model${c.reset}`,
      choices: FREE_MODELS,
    });

    if (modelChoice === 'custom') {
      const { customModel } = await prompt({
        type: 'input',
        name: 'customModel',
        message: 'Model ID (e.g. google/gemini-2.5-flash)',
        initial: config.model || '',
        validate: (v) => v.length > 0 || 'Model ID required',
      });
      config.model = customModel;
    } else {
      config.model = modelChoice;
    }
    step('Model', config.model);

    // API Key
    section('OpenRouter API Key');
    box([
      'Get a free key at:',
      `${c.cyan}${c.underline}https://openrouter.ai/keys${c.reset}`,
      '',
      'Free models require a key but cost nothing.',
    ]);
    nl();

    const { openrouterKey } = await prompt({
      type: 'password',
      name: 'openrouterKey',
      message: 'API key',
      initial: config.openrouterKey || '',
      validate: (v) => v.length > 0 || 'API key is required',
    });
    config.openrouterKey = openrouterKey;
    step('API key', maskKey(openrouterKey));

    // Telegram
    section('Telegram Bot');
    box([
      'Optional — chat with your agent from Telegram.',
      `Create a bot via ${c.cyan}@BotFather${c.reset} on Telegram.`,
      'Leave empty to skip.',
    ]);
    nl();

    const { telegramToken } = await prompt({
      type: 'input',
      name: 'telegramToken',
      message: 'Telegram bot token',
      initial: config.telegramToken || '',
    });

    if (telegramToken && telegramToken.trim()) {
      config.telegramToken = telegramToken.trim();
      step('Telegram', 'Configured');
    } else {
      delete config.telegramToken;
      step('Telegram', gray('Skipped'));
    }

    // Web UI port
    section('Web UI');
    const { webPort } = await prompt({
      type: 'input',
      name: 'webPort',
      message: 'Web UI port',
      initial: String(config.webPort || 3000),
      validate: (v) => {
        const n = parseInt(v);
        return (n > 0 && n < 65536) || 'Enter a valid port number';
      },
    });
    config.webPort = parseInt(webPort);
    step('Web UI port', String(config.webPort));
  }

  // Save config
  section('Saving');
  const s = spinner('Writing config.json...');
  saveConfig(config);
  await sleep(500);
  s.stop('Config saved to config.json');

  // Summary
  section('QuickStart');
  box([
    `${c.cyan}Agent:${c.reset}     ${config.agentName}`,
    `${c.cyan}Model:${c.reset}     ${config.model}`,
    `${c.cyan}Key:${c.reset}       ${maskKey(config.openrouterKey)}`,
    `${c.cyan}Telegram:${c.reset}  ${config.telegramToken ? 'enabled' : 'disabled'}`,
    `${c.cyan}Web UI:${c.reset}    http://localhost:${config.webPort}`,
  ]);

  nl();
  console.log(`  ${green('Ready!')} Run ${cyan('clawd start')} or ${cyan('node cli.js start')} to launch.`);

  if (isTermux()) {
    nl();
    console.log(`  ${yellow('Termux tips:')}`);
    console.log(`  ${gray('$')} termux-wake-lock`);
    console.log(`  ${gray('$')} tmux new -s clawd 'node cli.js start'`);
  }

  nl();
}

// ─── Start Agent ────────────────────────────────────

async function startAgent() {
  console.clear();
  banner();

  const config = loadConfig();
  if (!config) {
    console.log(`  ${red('No config found.')} Run ${cyan('clawd onboard')} first.\n`);
    process.exit(1);
  }

  section('Starting Agent');
  status('Agent', config.agentName, 'cyan');
  status('Model', config.model, 'cyan');
  status('Web UI', `http://localhost:${config.webPort || 3000}`, 'cyan');
  status('Telegram', config.telegramToken ? 'enabled' : 'disabled', config.telegramToken ? 'green' : 'gray');
  nl();

  const s = spinner('Loading skills...');
  await sleep(300);

  // Actually start the agent
  // Apply Bionic patch first
  const os = require('os');
  const _orig = os.networkInterfaces.bind(os);
  os.networkInterfaces = () => { try { return _orig(); } catch { return {}; } };

  require('dotenv').config();
  const { loadSkills } = require('./src/skills');
  const { startTelegram } = require('./src/telegram');
  const { startWebUI } = require('./src/webui');

  loadSkills();
  s.stop('Skills loaded');

  const s2 = spinner('Starting gateways...');
  await sleep(200);
  startTelegram(config);
  startWebUI(config);
  s2.stop('All gateways running');

  nl();
  divider();
  console.log(`  ${LOBSTER} ${bold(red('JongosAIFree is live.'))} ${LOBSTER}`);
  console.log(`  ${gray('Press Ctrl+C to stop.')}`);
  divider();
  nl();
}

// ─── Config View/Edit ───────────────────────────────

async function configCmd() {
  console.clear();
  banner();

  const config = loadConfig();
  if (!config) {
    console.log(`  ${red('No config found.')} Run ${cyan('clawd onboard')} first.\n`);
    process.exit(1);
  }

  section('Current Configuration');
  box([
    `${c.cyan}agent:${c.reset}     ${config.agentName || 'Paijo'}`,
    `${c.cyan}model:${c.reset}     ${config.model || '(not set)'}`,
    `${c.cyan}key:${c.reset}       ${maskKey(config.openrouterKey)}`,
    `${c.cyan}telegram:${c.reset}  ${config.telegramToken ? 'configured' : 'not set'}`,
    `${c.cyan}port:${c.reset}      ${config.webPort || 3000}`,
  ]);
  nl();

  const { action } = await prompt({
    type: 'select',
    name: 'action',
    message: 'What do you want to do?',
    choices: [
      { name: 'back', message: 'Back to menu' },
      { name: 'edit-key', message: 'Change API key' },
      { name: 'edit-model', message: 'Change model' },
      { name: 'edit-name', message: 'Change agent name' },
      { name: 'edit-telegram', message: 'Change Telegram token' },
      { name: 'edit-port', message: 'Change Web UI port' },
      { name: 'reconfigure', message: 'Full reconfigure (run onboard)' },
    ],
  });

  if (action === 'back') return;

  if (action === 'reconfigure') {
    await onboard();
    return;
  }

  if (action === 'edit-key') {
    const { key } = await prompt({
      type: 'password',
      name: 'key',
      message: 'New OpenRouter API key',
      validate: (v) => v.length > 0 || 'Key required',
    });
    config.openrouterKey = key;
  }

  if (action === 'edit-model') {
    const { model } = await prompt({
      type: 'input',
      name: 'model',
      message: 'New model ID',
      initial: config.model,
      validate: (v) => v.length > 0 || 'Model required',
    });
    config.model = model;
  }

  if (action === 'edit-name') {
    const { name } = await prompt({
      type: 'input',
      name: 'name',
      message: 'New agent name',
      initial: config.agentName,
    });
    config.agentName = name;
  }

  if (action === 'edit-telegram') {
    const { token } = await prompt({
      type: 'input',
      name: 'token',
      message: 'Telegram bot token (empty to disable)',
      initial: config.telegramToken || '',
    });
    if (token && token.trim()) {
      config.telegramToken = token.trim();
    } else {
      delete config.telegramToken;
    }
  }

  if (action === 'edit-port') {
    const { port } = await prompt({
      type: 'input',
      name: 'port',
      message: 'Web UI port',
      initial: String(config.webPort || 3000),
      validate: (v) => {
        const n = parseInt(v);
        return (n > 0 && n < 65536) || 'Valid port required';
      },
    });
    config.webPort = parseInt(port);
  }

  saveConfig(config);
  console.log(`\n  ${green('Config updated and saved.')}\n`);
}

// ─── Status ─────────────────────────────────────────

async function statusCmd() {
  console.clear();
  banner();

  const config = loadConfig();

  section('Agent Status');

  if (!config) {
    status('Config', 'not found', 'red');
    console.log(`\n  Run ${cyan('clawd onboard')} to set up.\n`);
    return;
  }

  status('Agent', config.agentName || 'Paijo', 'green');
  status('Model', config.model || '(not set)', 'cyan');
  status('API Key', maskKey(config.openrouterKey), config.openrouterKey ? 'green' : 'red');
  status('Telegram', config.telegramToken ? 'configured' : 'not configured', config.telegramToken ? 'green' : 'gray');
  status('Web Port', String(config.webPort || 3000), 'cyan');

  nl();
  section('Environment');

  status('Platform', isTermux() ? 'Termux (Android)' : process.platform, 'cyan');
  status('Node.js', process.version, 'cyan');
  status('Directory', __dirname, 'gray');

  // Check if skills exist
  const skillsDir = path.join(__dirname, 'skills');
  if (fs.existsSync(skillsDir)) {
    const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'));
    status('Skills', `${skillFiles.length} found`, 'green');
  } else {
    status('Skills', 'directory missing', 'red');
  }

  // Check data dir
  const dataDir = path.join(__dirname, 'data');
  if (fs.existsSync(dataDir)) {
    const memFile = path.join(dataDir, 'memory.json');
    if (fs.existsSync(memFile)) {
      const size = fs.statSync(memFile).size;
      status('Memory', `${(size / 1024).toFixed(1)} KB`, 'green');
    } else {
      status('Memory', 'empty (first run)', 'gray');
    }
  } else {
    status('Memory', 'data/ not created yet', 'gray');
  }

  // Test API key
  nl();
  section('API Connection');
  if (config.openrouterKey) {
    const s = spinner('Testing OpenRouter connection...');
    try {
      const axios = require('axios');
      const res = await axios.get('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${config.openrouterKey}` },
        timeout: 10000,
      });
      s.stop(`Connected — ${res.data?.data?.length || '?'} models available`);
    } catch (err) {
      if (err.response?.status === 401) {
        s.fail('Invalid API key');
      } else {
        s.fail(`Connection failed: ${err.message}`);
      }
    }
  } else {
    status('API', 'No key configured', 'red');
  }

  nl();
}

// ─── Skills ─────────────────────────────────────────

async function skillsCmd() {
  console.clear();
  banner();

  section('Loaded Skills');

  const skillsDir = path.join(__dirname, 'skills');
  if (!fs.existsSync(skillsDir)) {
    console.log(`  ${red('No skills directory found.')}\n`);
    return;
  }

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.js'));

  if (files.length === 0) {
    console.log(`  ${gray('No skills installed.')}\n`);
    return;
  }

  for (const file of files) {
    try {
      const skill = require(path.join(skillsDir, file));
      console.log(`  ${green('●')} ${c.bold}${skill.name || file}${c.reset}`);
      console.log(`    ${gray(skill.description || 'No description')}`);
      console.log(`    ${dim(`File: skills/${file}`)}`);
      nl();
    } catch (err) {
      console.log(`  ${red('●')} ${c.bold}${file}${c.reset}`);
      console.log(`    ${red(`Error: ${err.message}`)}`);
      nl();
    }
  }

  divider();
  console.log(`  ${gray('Add skills by dropping .js files into the skills/ directory.')}`);
  nl();
}

// ─── Reset ──────────────────────────────────────────

async function resetCmd() {
  console.clear();
  banner();

  section('Reset');

  const { what } = await prompt({
    type: 'select',
    name: 'what',
    message: 'What do you want to reset?',
    choices: [
      { name: 'cancel', message: 'Cancel' },
      { name: 'memory', message: 'Clear conversation memory only' },
      { name: 'config', message: 'Delete config (will need to run onboard again)' },
      { name: 'all', message: `${c.red}Reset everything (memory + config)${c.reset}` },
    ],
  });

  if (what === 'cancel') return;

  const { confirm } = await prompt({
    type: 'confirm',
    name: 'confirm',
    message: `${red('Are you sure?')} This cannot be undone.`,
    initial: false,
  });

  if (!confirm) {
    console.log(`\n  ${gray('Cancelled.')}\n`);
    return;
  }

  if (what === 'memory' || what === 'all') {
    const memFile = path.join(__dirname, 'data', 'memory.json');
    if (fs.existsSync(memFile)) {
      fs.unlinkSync(memFile);
      console.log(`  ${green('✓')} Memory cleared`);
    } else {
      console.log(`  ${gray('–')} No memory file found`);
    }
  }

  if (what === 'config' || what === 'all') {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.unlinkSync(CONFIG_PATH);
      console.log(`  ${green('✓')} Config deleted`);
    } else {
      console.log(`  ${gray('–')} No config file found`);
    }
  }

  nl();
  if (what === 'config' || what === 'all') {
    console.log(`  Run ${cyan('clawd onboard')} to reconfigure.\n`);
  }
}

// ─── Help ───────────────────────────────────────────

function helpCmd() {
  console.clear();
  banner();

  section('Commands');
  console.log('');
  console.log(`  ${cyan('clawd')}              Interactive menu`);
  console.log(`  ${cyan('clawd onboard')}      First-time setup wizard`);
  console.log(`  ${cyan('clawd start')}        Start the agent`);
  console.log(`  ${cyan('clawd config')}       View/edit configuration`);
  console.log(`  ${cyan('clawd status')}       Show agent & connection status`);
  console.log(`  ${cyan('clawd skills')}       List installed skills`);
  console.log(`  ${cyan('clawd reset')}        Reset memory or config`);
  console.log(`  ${cyan('clawd help')}         Show this help`);
  nl();

  section('Quick Start');
  console.log('');
  console.log(`  ${gray('1.')} ${cyan('clawd onboard')}    Set up API key and model`);
  console.log(`  ${gray('2.')} ${cyan('clawd start')}      Launch the agent`);
  console.log(`  ${gray('3.')} Open ${cyan('http://localhost:3000')} in browser`);
  nl();

  section('Links');
  console.log('');
  console.log(`  ${gray('Repo:')}     ${cyan('https://github.com/joymadhu49/clawd-agent')}`);
  console.log(`  ${gray('API Key:')} ${cyan('https://openrouter.ai/keys')}`);
  console.log(`  ${gray('Models:')}  ${cyan('https://openrouter.ai/models')}`);
  console.log(`  ${gray('Twitter:')} ${cyan('https://x.com/zx_joy_')}`);
  nl();
}

// ─── Interactive Menu ───────────────────────────────

async function interactiveMenu() {
  console.clear();
  banner();

  const config = loadConfig();

  if (config) {
    box([
      `${c.cyan}Agent:${c.reset}  ${config.agentName || 'Paijo'}`,
      `${c.cyan}Model:${c.reset}  ${config.model || '(not set)'}`,
      `${c.cyan}Key:${c.reset}    ${maskKey(config.openrouterKey)}`,
    ]);
  } else {
    box([
      `${c.yellow}No config found.${c.reset}`,
      `Select ${c.bold}Onboard${c.reset} to get started.`,
    ]);
  }

  nl();

  const choices = [
    { name: 'onboard', message: `${LOBSTER} Onboard     ${gray('— First-time setup wizard')}` },
    { name: 'start', message: `${green('▶')} Start       ${gray('— Launch the agent')}` },
    { name: 'config', message: `${cyan('⚙')} Config      ${gray('— View/edit settings')}` },
    { name: 'status', message: `${blue('◉')} Status      ${gray('— Check agent & API health')}` },
    { name: 'skills', message: `${magenta('◆')} Skills      ${gray('— List loaded plugins')}` },
    { name: 'reset', message: `${red('⟲')} Reset       ${gray('— Clear memory or config')}` },
    { name: 'help', message: `${yellow('?')} Help        ${gray('— Commands and links')}` },
    { name: 'exit', message: `${gray('✕ Exit')}` },
  ];

  const { action } = await prompt({
    type: 'select',
    name: 'action',
    message: `${c.bold}What do you want to do?${c.reset}`,
    choices,
  });

  switch (action) {
    case 'onboard': await onboard(); break;
    case 'start': await startAgent(); break;
    case 'config': await configCmd(); break;
    case 'status': await statusCmd(); break;
    case 'skills': await skillsCmd(); break;
    case 'reset': await resetCmd(); break;
    case 'help': helpCmd(); break;
    case 'exit': process.exit(0);
  }
}

// ─── Utility ────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Main ───────────────────────────────────────────

async function main() {
  const cmd = process.argv[2];

  try {
    switch (cmd) {
      case 'onboard':
      case 'setup':
        await onboard();
        break;
      case 'start':
      case 'run':
        await startAgent();
        break;
      case 'config':
        await configCmd();
        break;
      case 'status':
        await statusCmd();
        break;
      case 'skills':
        await skillsCmd();
        break;
      case 'reset':
        await resetCmd();
        break;
      case 'help':
      case '--help':
      case '-h':
        helpCmd();
        break;
      default:
        await interactiveMenu();
        break;
    }
  } catch (err) {
    if (err.message === '' || err.code === 'ERR_USE_AFTER_CLOSE') {
      // Ctrl+C
      console.log(`\n  ${gray('Cancelled.')}\n`);
    } else {
      console.error(`\n  ${red('Error:')} ${err.message}\n`);
    }
    process.exit(1);
  }
}

main();
