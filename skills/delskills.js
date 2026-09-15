const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(__dirname);
const PROTECTED = new Set([
  'addskill', 'delskills', 'shell', 'readfile', 'writefile',
  'fetch', 'remember', 'device-info', 'clawd-scan',
]);

module.exports = {
  name: 'delskills',
  description: 'Hapus skill. Contoh: delskill: namaskill',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('delskills:') || t.startsWith('delskill:') || t.startsWith('rmskill:');
  },

  async run(text) {
    let name = text.replace(/^(delskills:|delskill:|rmskill:)\s*/i, '').trim()
      .toLowerCase()
      .replace(/\.js$/i, '')
      .replace(/[^a-z0-9_-]/g, '');

    if (!name) return 'Contoh: delskill: namaskill';

    if (PROTECTED.has(name)) {
      return `Skill "${name}" dilindungi, tidak bisa dihapus via chat.`;
    }

    const filePath = path.join(SKILLS_DIR, `${name}.js`);
    if (!fs.existsSync(filePath)) {
      return `Skill tidak ditemukan: ${name}.js`;
    }

    try {
      fs.unlinkSync(filePath);
      try {
        const skillsMod = require('../src/skills');
        if (typeof skillsMod.loadSkills === 'function') skillsMod.loadSkills();
      } catch {}
      return `✓ Skill dihapus: ${name}.js`;
    } catch (e) {
      return `Gagal hapus: ${e.message}`;
    }
  },
};
