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

  // Cegah command chaining, pipe, redirect,
  // command substitution, dan background execution.
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

  if (commandName.startsWith('termux-')) {
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
