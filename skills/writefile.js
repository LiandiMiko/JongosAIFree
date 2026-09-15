const fs = require('fs');
const path = require('path');

function resolvePath(p) {
  const home = process.env.HOME || '';
  let out = p.trim();
  if (out.startsWith('\~')) {
    out = path.join(home, out.slice(1));
  }
  out = out.replace(/\$HOME/g, home);
  out = out.replace(/\$\{HOME\}/g, home);
  return path.resolve(out);
}

module.exports = {
  name: 'writefile',
  description: 'Tulis file. Format: write: $HOME/catatan.txt | isi teks',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('write:') || t.startsWith('tulis:');
  },

  async run(text) {
    const raw = text.replace(/^(write:|tulis:)\s*/i, '').trim();
    const sep = raw.indexOf('|');
    if (sep === -1) {
      return 'Format:\nwrite: $HOME/catatan.txt | isi catatan di sini';
    }

    const filePath = resolvePath(raw.slice(0, sep).trim());
    const content = raw.slice(sep + 1).trim();

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
      return `✓ Tersimpan: ${filePath}`;
    } catch (e) {
      return `Gagal tulis: ${e.message}`;
    }
  },
};

