const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const SAFE_COMMANDS = new Set([
  'echo',
  'pwd',
  'ls',
  'whoami',
  'id',
  'uname',
  'date',
  'uptime',
  'df',
  'du',
  'free',
  'ps',
  'env',
  'which',
  'command',
  'termux-battery-status',
  'termux-wifi-connectioninfo',
]);

const BLOCKED_COMMANDS = new Set([
  'rm',
  'rmdir',
  'mv',
  'chmod',
  'chown',
  'chgrp',
  'mkfs',
  'dd',
  'kill',
  'pkill',
  'killall',
  'reboot',
  'shutdown',
  'su',
  'sudo',
]);

// FIX S7: Add explicit allowlist for termux commands instead of prefix matching
const SAFE_TERMUX_COMMANDS = new Set([
  'termux-battery-status',
  'termux-wifi-connectioninfo',
]);

function getCommandName(cmd) {
  return cmd.trim().split(/\s+/)[0].toLowerCase();
}

function validateShellCommand(cmd) {
  if (!cmd) {
    return {
      allowed: false,
      reason: 'Command kosong.',
    };
  }

  // FIX S7: Block single & (Windows cmd.exe separator), ^ (escape), % (var expansion)
  // in addition to existing bash-style operators
  const dangerousSyntax = [
    ';',
    '&&',
    '||',
    '|',
    '>',
    '<',
    '`',
    '$(',
    '${',
    '\n',
    '\r',
    '&',   // Windows cmd.exe command separator
    '^',   // Windows cmd.exe escape character
    '%',   // Windows variable expansion (%PATH%, %USERNAME%)
  ];

  for (const token of dangerousSyntax) {
    if (cmd.includes(token)) {
      return {
        allowed: false,
        reason: `Sintaks shell "${token}" diblokir untuk keamanan.`,
      };
    }
  }

  const commandName = getCommandName(cmd);

  if (BLOCKED_COMMANDS.has(commandName)) {
    return {
      allowed: false,
      reason: `Command "${commandName}" diblokir untuk keamanan.`,
    };
  }

  // FIX S7: Use explicit set instead of prefix match to prevent bypass
  if (SAFE_TERMUX_COMMANDS.has(commandName)) {
    return {
      allowed: true,
    };
  }

  if (!SAFE_COMMANDS.has(commandName)) {
    return {
      allowed: false,
      reason:
        `Command "${commandName}" belum masuk allowlist shell.`,
    };
  }

  return {
    allowed: true,
  };
}

module.exports = {
  name: 'shell',
  description:
    'Jalankan perintah Termux yang diizinkan. Contoh: run: ls',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return (
      t.startsWith('run:') ||
      t.startsWith('shell:')
    );
  },

  async run(text) {
    const cmd = text
      .replace(/^(run:|shell:)\s*/i, '')
      .trim();

    if (!cmd) {
      return [
        'Contoh pakai:',
        'run: ls',
        'run: pwd',
        'run: termux-battery-status',
      ].join('\n');
    }

    const validation = validateShellCommand(cmd);

    if (!validation.allowed) {
      return `Perintah diblokir: ${validation.reason}`;
    }

    try {
      const { stdout, stderr } =
        await execAsync(cmd, {
          timeout: 20000,
          maxBuffer: 1024 * 1024,
          shell: true,
        });

      const out =
        (stdout || '') +
        (stderr || '');

      return (
        out.trim().slice(0, 3500) ||
        '(tidak ada output)'
      );
    } catch (e) {
      return `Error: ${(
        e.stderr ||
        e.message ||
        String(e)
      ).slice(0, 1500)}`;
    }
  },
};
