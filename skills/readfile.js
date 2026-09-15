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
  name: 'readfile',
  description: 'Baca isi file. Contoh: read: $HOME/clawd-agent/config.json',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('read:') || t.startsWith('baca:');
  },

  async run(text) {
    const filePath = text.replace(/^(read:|baca:)\s*/i, '').trim();
    if (!filePath) return 'Contoh: read: $HOME/clawd-agent/config.json';

    const resolved = resolvePath(filePath);

    try {
      if (!fs.existsSync(resolved)) return `File tidak ditemukan: ${resolved}`;
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return 'Path itu bukan file.';
      if (stat.size > 200000) return 'File terlalu besar (max \~200KB).';

      const content = fs.readFileSync(resolved, 'utf-8');
      return `📄 \( {resolved}\n\n \){content.slice(0, 3500)}`;
    } catch (e) {
      return `Gagal baca file: ${e.message}`;
    }
  },
};
