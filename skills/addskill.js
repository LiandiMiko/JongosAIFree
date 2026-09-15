const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname);

function sanitizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\.js$/i, '')
    .replace(/[^a-z0-9_-]/g, '');
}

function isValidSkillCode(code) {
  return (
    code.includes('module.exports') &&
    code.includes('trigger') &&
    code.includes('run')
  );
}

module.exports = {
  name: 'addskill',
  description: 'Tambah skill baru via chat. Format: addskill: nama | <kode js>',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return (
      t.startsWith('addskill:') ||
      t.startsWith('newskill:') ||
      t.startsWith('createskill:')
    );
  },

  async run(text) {
    const raw = text.replace(/^(addskill:|newskill:|createskill:)\s*/i, '').trim();

    // Format A: addskill: nama | kode
    // Format B: addskill: nama\n kode...
    let namePart = '';
    let code = '';

    if (raw.includes('|')) {
      const idx = raw.indexOf('|');
      namePart = raw.slice(0, idx).trim();
      code = raw.slice(idx + 1).trim();
    } else {
      const lines = raw.split('\n');
      namePart = (lines.shift() || '').trim();
      code = lines.join('\n').trim();
    }

    // Hapus markdown code fence kalau user paste dari editor
    code = code
      .replace(/^```(?:js|javascript)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    const name = sanitizeName(namePart);
    if (!name) {
      return [
        'Format tambah skill:',
        '',
        'addskill: namaskill | module.exports = { ... }',
        '',
        'atau multi-baris:',
        'addskill: namaskill',
        'module.exports = {',
        '  name: "namaskill",',
        '  description: "deskripsi",',
        '  trigger(text) { return text.startsWith("xyz:"); },',
        '  async run(text) { return "ok"; }',
        '};',
        '',
        'Nama hanya boleh: a-z, 0-9, _ , -',
      ].join('\n');
    }

    if (!code) {
      return `Nama skill: ${name}\n\nKode masih kosong. Sisipkan kode setelah | atau di baris berikutnya.`;
    }

    if (!isValidSkillCode(code)) {
      return 'Kode skill tidak valid. Harus ada module.exports, trigger, dan run.';
    }

    // Larang timpa skill sistem penting
    const protectedSkills = ['addskill', 'shell', 'readfile', 'writefile'];
    if (protectedSkills.includes(name)) {
      return `Skill "${name}" dilindungi. Pilih nama lain.`;
    }

    const filePath = path.join(SKILLS_DIR, `${name}.js`);

    try {
      fs.writeFileSync(filePath, code.endsWith('\n') ? code : code + '\n', 'utf-8');
    } catch (e) {
      return `Gagal menulis skill: ${e.message}`;
    }

    // Coba hot-reload
    let reloadMsg = 'Restart agent supaya skill aktif: node cli.js start';
    try {
      const skillsMod = require('../src/skills');
      if (typeof skillsMod.loadSkills === 'function') {
        skillsMod.loadSkills();
        reloadMsg = 'Skill di-reload tanpa restart.';
      }
    } catch (e) {
      reloadMsg = `File tersimpan. Reload gagal (${e.message}). Restart agent.`;
    }

    return [
      `✓ Skill disimpan: ${filePath}`,
      reloadMsg,
      '',
      'Cek dengan: /skills',
      'atau: run: ls $HOME/clawd-agent/skills',
    ].join('\n');
  },
};
