const axios = require('axios');

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

    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 500000,
        headers: {
          'User-Agent': 'JongosAIFree/1.0',
          Accept: 'application/json, text/plain, text/html, */*',
        },
      });
      let body =
        typeof res.data === 'string'
          ? res.data
          : JSON.stringify(res.data, null, 2);
      // buang tag HTML kasar (JSON tetap utuh)
      if (typeof res.data === 'string' && /<html/i.test(body)) {
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
