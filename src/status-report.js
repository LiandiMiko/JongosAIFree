/**
 * Shared LLM provider status report for Telegram /status and natural queries.
 */

/** Deteksi pertanyaan status API / token / kuota (bukan status server di vault) */
function isProviderStatusQuery(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;

  if (
    t === '/status' ||
    t === 'status' ||
    t === 'cek status' ||
    t === 'status?' ||
    t.startsWith('/status')
  ) {
    return true;
  }

  const aboutProvider =
    /\b(token|api|provider|kuota|quota|llm|gemini|groq|key|pemakaian|usage|request|sambanova|openrouter|mistral)\b/i.test(
      t
    );

  const asksStatus =
    /\b(status|cek|sisa|berapa|info|lihat|tampilkan|show)\b/i.test(t);

  if (aboutProvider && asksStatus) return true;

  if (
    /\bstatus\s+(token|api|provider|llm|kuota|quota|key)\b/i.test(t) ||
    /\b(token|api|provider|kuota|quota)\s+status\b/i.test(t) ||
    /\bcek\s+(token|kuota|quota|provider|api|usage)\b/i.test(t) ||
    /\b(sisa|berapa)\s+(kuota|quota|request|token)\b/i.test(t)
  ) {
    return true;
  }

  return false;
}

function listConfiguredProviders() {
  try {
    const { hasProviderKey, PROVIDERS } = require('./providers');
    return Object.keys(PROVIDERS || {}).filter((p) => {
      try {
        return hasProviderKey(p);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

/**
 * @param {{ html?: boolean, showAll?: boolean }} opts
 *   showAll: true → tampilkan juga usage provider tanpa key (histori)
 * @returns {string}
 */
function formatProviderStatus(opts = {}) {
  const html = opts.html !== false;
  const showAll = opts.showAll === true;

  let all = [];
  try {
    const { getAllProviderStatus } = require('./llm-status');
    all = getAllProviderStatus() || [];
  } catch {
    all = [];
  }

  let PROVIDERS = {};
  try {
    PROVIDERS = require('./providers').PROVIDERS || {};
  } catch {
    PROVIDERS = {};
  }

  const configured = listConfiguredProviders();
  const configuredSet = new Set(configured.map((p) => String(p).toLowerCase()));

  const activeUsage = [];
  const hiddenUsage = [];
  for (const e of all) {
    const p = String(e.provider || '').toLowerCase();
    if (!configured.length || configuredSet.has(p) || showAll) {
      activeUsage.push(e);
    } else {
      hiddenUsage.push(e);
    }
  }

  // Sort: configured providers first, then by requests desc
  activeUsage.sort((a, b) => {
    const ra = Number(a.usage?.requests || 0);
    const rb = Number(b.usage?.requests || 0);
    return rb - ra;
  });

  const esc = (v) => {
    const s = String(v == null ? '' : v);
    if (!html) return s;
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };
  const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
  const b = (s) => (html ? `<b>${s}</b>` : `**${s}**`);
  const code = (s) => (html ? `<code>${s}</code>` : `\`${s}\``);
  const i = (s) => (html ? `<i>${s}</i>` : `_${s}_`);

  const lines = [];
  lines.push(b('📊 LLM / Provider Status'));
  lines.push('');

  if (configured.length) {
    lines.push(b('Key di .env (aktif):'));
    for (const p of configured) {
      const name = PROVIDERS[p]?.name || p;
      const providerEntries = activeUsage.filter(
        (e) => String(e.provider || '').toLowerCase() === p.toLowerCase()
      );
      const totalReq = providerEntries.reduce(
        (sum, e) => sum + Number(e.usage?.requests || 0),
        0
      );
      const suffix = totalReq ? ` — ${fmt(totalReq)} req` : '';
      lines.push(`• ${esc(name)} (${code(p)})${suffix}`);
    }
    lines.push('');
  } else {
    lines.push('⚠️ Tidak ada provider dengan API key di .env.');
    lines.push('');
  }

  if (!activeUsage.length) {
    lines.push('Belum ada data usage untuk provider aktif.');
    if (hiddenUsage.length) {
      lines.push(
        i(
          `Ada ${hiddenUsage.length} entri histori provider lain (tanpa key di .env) — disembunyikan.`
        )
      );
    }
    return lines.join('\n');
  }

  lines.push(b('Usage per model (lokal):'));
  lines.push('');

  for (const e of activeUsage) {
    const u = e.usage || {};
    const keyLabel = e.keyId != null ? ` (key #${e.keyId})` : '';
    lines.push(b(esc(e.provider) + ' / ' + esc(e.model) + esc(keyLabel)));
    lines.push('• Status        : ' + code(esc(e.status || 'unknown')));
    lines.push('• Requests      : ' + fmt(u.requests));
    lines.push('• Input tokens  : ' + fmt(u.inputTokens));
    lines.push('• Output tokens : ' + fmt(u.outputTokens));
    lines.push('• Total tokens  : ' + fmt(u.totalTokens));
    if (e.limit !== null && e.limit !== undefined) {
      lines.push('• Quota limit   : ' + fmt(e.limit));
      lines.push('• Quota remain  : ' + fmt(e.remaining));
      lines.push('• Quota used    : ' + fmt(e.used));
    }
    if (e.retryAfter) lines.push('• Retry after   : ' + esc(e.retryAfter) + 's');
    if (e.resetAt) lines.push('• Reset at      : ' + esc(e.resetAt));
    if (e.lastError) lines.push('• Last error    : ' + esc(e.lastError));
    lines.push('');
  }

  if (hiddenUsage.length && !showAll) {
    const names = [
      ...new Set(hiddenUsage.map((e) => e.provider).filter(Boolean)),
    ].join(', ');
    lines.push(
      i(
        `Histori disembunyikan: ${names} (${hiddenUsage.length} entri, tidak ada key di .env). Ketik /status all untuk lihat semua.`
      )
    );
    lines.push('');
  }

  lines.push(
    i('Catatan: angka request = counter lokal agent, bukan dashboard resmi provider.')
  );

  return lines.join('\n');
}

module.exports = {
  isProviderStatusQuery,
  formatProviderStatus,
  listConfiguredProviders,
};
