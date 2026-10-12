const axios = require('axios');
const dns = require('dns');
const net = require('net');

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => part < 0 || part > 255)) return false;

  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateAddress(address) {
  let normalized = String(address || '').replace(/^\[|\]$/g, '').toLowerCase();
  const version = net.isIP(normalized);

  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return false;

  if (normalized.includes('.')) {
    const splitAt = normalized.lastIndexOf(':');
    const octets = normalized.slice(splitAt + 1).split('.').map(Number);
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${normalized.slice(0, splitAt + 1)}${high}:${low}`;
  }

  const groups = normalized.split('::');
  const left = groups[0] ? groups[0].split(':') : [];
  const right = groups[1] ? groups[1].split(':') : [];
  const expanded = [
    ...left,
    ...Array(8 - left.length - right.length).fill('0'),
    ...right,
  ].map((group) => parseInt(group || '0', 16));

  if (expanded[0] === 0 && expanded.slice(1, 7).every((group) => group === 0)) {
    if (expanded[7] === 0 || expanded[7] === 1) return true;
  }

  // IPv4-mapped IPv6 addresses must be checked against the IPv4 ranges too.
  if (
    expanded.slice(0, 5).every((group) => group === 0) &&
    expanded[5] === 0xffff
  ) {
    const ipv4 = [
      expanded[6] >> 8,
      expanded[6] & 0xff,
      expanded[7] >> 8,
      expanded[7] & 0xff,
    ].join('.');
    return isPrivateIpv4(ipv4);
  }

  const first = expanded[0];
  return (
    (first & 0xfe00) === 0xfc00 || // Unique-local
    (first & 0xffc0) === 0xfe80 || // Link-local
    (first & 0xff00) === 0xff00 // Multicast
  );
}

function isPrivateHost(hostname) {
  const host = String(hostname || '')
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();

  return (
    isPrivateAddress(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  );
}

function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }

  const lookupOptions = { all: true, verbatim: true };
  if (options && options.family) lookupOptions.family = options.family;

  dns.lookup(hostname, lookupOptions, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      return callback(new Error('Fetch diblokir: hostname mengarah ke alamat lokal/internal.'));
    }

    if (options && options.all) return callback(null, addresses);

    const { address, family } = addresses[0];
    return callback(null, address, family);
  });
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

    if (!/^https?:\/\//i.test(url)) {
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

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return 'Gagal fetch: hanya URL HTTP/HTTPS yang didukung.';
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    if (isPrivateHost(hostname)) {
      return 'Gagal fetch: URL lokal/internal diblokir untuk keamanan.';
    }

    try {
      const res = await axios.get(url, {
        timeout: 15000,
        maxContentLength: 500000,
        lookup: safeLookup,
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

  isPrivateAddress,
  isPrivateHost,
  safeLookup,
};
