const axios = require('axios');

module.exports = {
  name: 'fetch',
  description: 'Ambil teks dari URL. Contoh: fetch: https://example.com',

  trigger(text) {
    const t = text.trim().toLowerCase();
    return t.startsWith('fetch:') || t.startsWith('ambil:');
  },

  async run(text) {
    const url = text.replace(/^(fetch:|ambil:)\s*/i, '').trim();
    if (!url.startsWith('http')) {
      return 'Contoh: fetch: https://example.com';
    }

    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 500000,
        headers: { 'User-Agent': 'ClawdAgent/1.0' },
      });
      let body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
      // buang tag HTML kasar
      body = body.replace(/<script[\s\S]*?<\/script>/gi, '')
                 .replace(/<style[\s\S]*?<\/style>/gi, '')
                 .replace(/<[^>]+>/g, ' ')
                 .replace(/\s+/g, ' ')
                 .trim();
      return body.slice(0, 3500) || '(kosong)';
    } catch (e) {
      return `Gagal fetch: ${e.message}`;
    }
  },
};

