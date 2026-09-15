const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

module.exports = {
  name: 'ping',
  description: 'Ping host. Contoh: run: ping  atau  ping: google.com',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t === 'run: ping' || t.startsWith('run: ping ') || t.startsWith('ping:');
  },

  async run(text) {
    let host = 'google.com';
    const t = text.trim();

    if (t.toLowerCase().startsWith('ping:')) {
      host = t.slice(5).trim() || 'google.com';
    } else if (t.toLowerCase().startsWith('run: ping')) {
      host = t.slice('run: ping'.length).trim() || 'google.com';
    }

    // sederhana: hanya hostname/IP
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) {
      return 'Host tidak valid. Contoh: ping: google.com';
    }

    try {
      const { stdout, stderr } = await execAsync(`ping -c 4 ${host}`, {
        timeout: 20000,
        shell: true,
      });
      return ((stdout || '') + (stderr || '')).trim().slice(0, 3000) || '(tidak ada output)';
    } catch (e) {
      return `Error: ${(e.stderr || e.message || String(e)).slice(0, 1500)}`;
    }
  },
};
