const axios = require('axios');

// FIX S6: Block SSRF targets — loopback, link-local, private IP ranges
const BLOCKED_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;
const PRIVATE_RANGES = /^(10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|fc00:|fe80:)/i;

function isPrivateHost(hostname) {
  return BLOCKED_HOSTS.test(hostname) || PRIVATE_RANGES.test(hostname);
}

module.exports = {
  name: 'fetch',
  description:
    'Ambil data dari URL (HTML atau JSON). WAJIB dipakai untuk harga kripto/berita/cuaca real-time. ' +
    'Contoh harga Binance: fetch dengan args.url = https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT ' +
    '(ganti symbol: ONDOUSDT, TAOUSDT, ETHUSDT, dll). Jangan pakai shell untuk ini.',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('fetch:') || t.startsWith('ambil:');
  },

  async run(text) {
    const url = text.replace(/^(fetch:|ambil:)\s*/i, '').trim();

    if (!url.startsWith('http')) {
      return (
        'Contoh: fetch: https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT\n' +
        'Atau: fetch: https://example.com'
      );
    }

    // FIX S6: Validate URL and block internal/private targets
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return 'Gagal fetch: URL tidak valid.';
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (isPrivateHost(hostname)) {
      return 'Gagal fetch: URL lokal/internal diblokir untuk keamanan.';
    }

    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 500000,
        headers: {
          'User-Agent': 'JongosAIFree/1.0',
          Accept: 'application/json, text/plain, text/html, */*',
        },
      });

      // FIX: Check content-type before processing binary responses
      const ctype = String(res.headers?.['content-type'] || '');
      if (!/json|text|xml|html|javascript/i.test(ctype) && typeof res.data !== 'string' && typeof res.data !== 'object') {
        return `[Data binary (${ctype || 'unknown'}) tidak dapat diproses sebagai teks]`;
      }

      let body =
        typeof res.data === 'string'
          ? res.data
          : JSON.stringify(res.data, null, 2);

      // Buang tag HTML kasar (JSON tetap utuh)
      if (typeof res.data === 'string' && /\<html/i.test(body)) {
        body = body
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      return body.slice(0, 3500) || '(kosong)';
    } catch (e) {
      return `Gagal fetch: ${e.message}`;
    }
  },
};
