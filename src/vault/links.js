/**
 * Ambil daftar wiki link dari konten markdown.
 * Contoh: [[Note A]], [[Note B|alias]], [[Note C#heading]]
 * Hasil: nama note saja, huruf kecil, unik.
 */
function extractLinks(content) {
  const text = String(content || '');
  const matches = text.match(/\[\[([^\]]+)\]\]/g) || [];

  const names = matches.map((m) => {
    const inner = m.slice(2, -2);
    return inner.split('|')[0].split('#')[0].trim().toLowerCase();
  });

  return [...new Set(names.filter(Boolean))];
}

module.exports = {
  extractLinks,
};