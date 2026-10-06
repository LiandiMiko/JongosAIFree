const { getSkillManifest } = require('../skills');

function buildToolManifest() {
  return getSkillManifest();
}

/**
 * Unified intent classifier.
 * Types: status | time | realtime | vault | shell | general
 */

/** Deteksi permintaan catat progres / knowledge log project. */
function isProgressLogIntent(t) {
  const s = String(t || '').toLowerCase();
  if (!s.trim()) return false;
  return (
    /\b(catat\s+progres|update\s+knowledge|simpan\s+ke\s+knowledge|log\s+progres|progress\s+log)\b/i.test(
      s
    ) ||
    /^catat\s+progres\s*:/i.test(s.trim())
  );
}

function extractProgressLogContent(text) {
  const raw = String(text || '').trim();
  const m = raw.match(
    /^(?:catat\s+progres|update\s+knowledge|simpan\s+ke\s+knowledge|log\s+progres)\s*[:\-–]\s*(.+)$/i
  );
  if (m) return m[1].trim();
  return raw;
}

function classifyIntent(text) {
  const raw = String(text || '').trim();
  const t = raw.toLowerCase();

  const result = {
    type: 'general',
    confidence: 'low',
    skipRag: false,
    preferTools: [],
    blockTools: [],
    hints: [],
  };

  if (!t) {
    result.tier = 'light';
    return result;
  }

  // --- STATUS (provider / token / kuota) — highest priority for short queries
  const statusHit = isStatusIntent(t);
  if (statusHit) {
    result.type = 'status';
    result.confidence = 'high';
    result.skipRag = true;
    result.blockTools = ['shell', 'fetch', 'obsidian-search', 'obsidian-read'];
    result.hints.push('Pertanyaan status provider/token/kuota — jawab via laporan status, bukan vault.');
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  // --- TIME ONLY (jam/tanggal hari ini tanpa data live lain)
  const timeOnly = isTimeOnlyIntent(t);
  if (timeOnly) {
    result.type = 'time';
    result.confidence = 'high';
    result.skipRag = true;
    result.blockTools = ['shell', 'fetch'];
    result.preferTools = [];
    result.hints.push('Cukup pakai waktu server; tidak perlu shell/fetch/vault.');
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  // --- PROGRESS LOG (subset vault, more specific)
  if (isProgressLogIntent(t)) {
    const entry = extractProgressLogContent(raw);
    result.type = 'vault';
    result.confidence = 'high';
    result.skipRag = true;
    result.preferTools = ['obsidian-append', 'obsidian-create'];
    result.blockTools = ['shell', 'fetch', 'obsidian-search'];
    result.progressLog = {
      note: '04 Knowledge/JongosAIFree.md',
      entry,
    };
    result.hints.push(
      'PROGRESS LOG: Jangan search. Langsung obsidian-append (atau create jika belum ada).'
    );
    result.hints.push(
      `Args WAJIB: {"note":"04 Knowledge/JongosAIFree.md","content":"- [TANGGAL_HARI_INI] ${entry.replace(/"/g, "'")}"}`
    );
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  // --- VAULT (explicit memory / note requests)
  const vaultHit = isVaultIntent(t);
  if (vaultHit.matched) {
    result.type = 'vault';
    result.confidence = vaultHit.confidence;
    result.skipRag = false;
    result.preferTools = [
      'obsidian-search',
      'obsidian-read',
      'obsidian-tree',
      'obsidian-tags',
      'obsidian-context',
      'obsidian-backlinks',
    ];
    result.blockTools = [];
    result.hints.push('Prioritaskan tool obsidian-* / RAG; jangan mengarang isi note.');
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  // --- REALTIME (harga, berita, cuaca, crypto live, ticker *USDT)
  const tickers = extractTickers(raw);
  const liveHit = isRealtimeIntent(t) || tickers.length > 0;
  if (liveHit) {
    result.type = 'realtime';
    result.confidence = 'high';
    result.skipRag = true;
    result.preferTools = ['fetch'];
    result.blockTools = ['shell'];
    result.tickers = tickers;
    result.hints.push(
      'Data live: WAJIB fetch ke sumber online. Jangan shell/curl, jangan andalkan RAG vault.'
    );
    if (tickers.length) {
      const primary = tickers[0];
      result.hints.push(
        `Ticker terdeteksi: ${tickers.join(', ')}. ` +
          `Fetch PERSIS pair ini di Binance: ` +
          `https://api.binance.com/api/v3/ticker/price?symbol=${primary} ` +
          `(JANGAN ganti ke token lain seperti XAUT/PAXG kecuali user minta itu).`
      );
    }
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  // --- SHELL-ish (sistem lokal eksplisit)
  if (isShellIntent(t)) {
    result.type = 'shell';
    result.confidence = 'medium';
    result.skipRag = true;
    result.preferTools = ['shell', 'device-info'];
    result.hints.push('Perintah sistem lokal — shell hanya untuk satu command sederhana, tanpa chaining.');
    result.tier = classifyTaskTier(raw, result);
    return result;
  }

  result.type = 'general';
  result.confidence = 'low';
  result.tier = classifyTaskTier(raw, result);
  return result;
}

/**
 * Deteksi tingkat kesulitan tugas: 'light' (RAG / Q&A / lookup / time) vs 'heavy' (coding, script, debug, complex math, shell)
 */
function classifyTaskTier(text, intent = {}) {
  const s = String(text || '').toLowerCase();

  // Heavy criteria: coding, programming, debugging, refactoring, complex math, script creation, shell execution, multi-step organize/batch
  const isHeavy =
    intent.type === 'shell' ||
    /\b(coding|code|koding|script|bikin\s+fungsi|refactor|debug|fix\s+bug|algoritma|arsitektur|analisis\s+mendalam|analisa\s+berat|buatkan\s+program|persamaan|writefile|write:|addskill)\b/i.test(s) ||
    (intent.type === 'vault' && /\b(organize|batch|audit\s+apply|refactor)\b/i.test(s));

  return isHeavy ? 'heavy' : 'light';
}

function isStatusIntent(t) {
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
    /\b(token|api\s*key|provider|kuota|quota|llm|gemini|groq|pemakaian|usage|sambanova|openrouter|mistral|llm7)\b/i.test(
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

function isTimeOnlyIntent(t) {
  // Must ask about time/date AND not ask about price/news/weather
  const asksTime =
    /\b(jam|tanggal|hari)\b/i.test(t) &&
    /\b(berapa|sekarang|hari ini|saat ini)\b/i.test(t);

  const hasLivePayload =
    /\b(harga|price|kurs|cuaca|weather|berita|news|btc|bitcoin|eth|crypto|kripto|saham)\b/i.test(
      t
    );

  // Pure time questions
  if (
    /^(jam berapa|tanggal berapa|hari apa|hari ini tanggal berapa|sekarang jam berapa)[\s?]*$/i.test(
      t
    )
  ) {
    return true;
  }

  return asksTime && !hasLivePayload;
}

function isVaultIntent(t) {
  const strong =
    /\b(vault|obsidian)\b/i.test(t) ||
    /\b(baca|buka|tampilkan|lihat|cari|search)\b.{0,40}\b(note|catatan|file)\b/i.test(t) ||
    /\b(note|catatan)\b.{0,40}\b(tentang|soal|mengenai|project|proyek)\b/i.test(t) ||
    /\b(second\s*brain|knowledge|progres|progress\s*log)\b/i.test(t) ||
    /\b(append|tambah|update|edit|hapus|pindah|rapikan)\b.{0,30}\b(note|catatan|vault)\b/i.test(
      t
    ) ||
    /\b(list|isi|struktur)\b.{0,20}\b(folder|vault|note)\b/i.test(t);

  const medium =
    /\b(catatan|note)\s+(saya|aku|ku)\b/i.test(t) ||
    /\b(yang pernah|yang sudah)\s+(aku|saya)\s+(tulis|catat)\b/i.test(t);

  if (strong) return { matched: true, confidence: 'high' };
  if (medium) return { matched: true, confidence: 'medium' };
  return { matched: false, confidence: 'low' };
}

/** Deteksi simbol pair exchange: BTCUSDT, XAUUSDT, ETHUSDT, dll. */
function extractTickers(text) {
  const s = String(text || '');
  const found = new Set();
  const quotes = ['USDT', 'BUSD', 'USDC', 'USD'];
  const re = /\b([A-Za-z]{4,20})\b/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const tok = m[1].toUpperCase();
    for (const q of quotes) {
      if (tok.endsWith(q) && tok.length > q.length + 1) {
        found.add(tok);
        break;
      }
    }
  }
  if (/\b(btc|bitcoin)\b/i.test(s)) found.add('BTCUSDT');
  if (/\b(eth|ethereum)\b/i.test(s) && !found.has('ETHUSDT')) {
    if (/\b(harga|price|berapa)\b/i.test(s)) found.add('ETHUSDT');
  }
  // Typo / shorthand umum: "xausdt" → XAUUSDT
  const aliases = {
    XAUSDT: 'XAUUSDT',
    XAUUSD: 'XAUUSDT',
    GOLDUSDT: 'XAUUSDT',
  };
  const normalized = new Set();
  for (const sym of found) normalized.add(aliases[sym] || sym);
  return [...normalized];
}

function isRealtimeIntent(t) {
  if (extractTickers(t).length > 0) return true;

  const liveKeyword =
    /\b(harga|price|kurs|cuaca|weather|berita|news|ticker|spot)\b/i.test(t) ||
    /\b(btc|bitcoin|eth|ethereum|usdt|ondo|tao|bittensor|crypto|kripto|saham|stock|forex|xau|gold)\b/i.test(
      t
    );

  const liveTime =
    /\b(saat ini|sekarang|real[\s-]?time|terkini|terbaru|live|hari ini)\b/i.test(t);

  if (/\b(harga|price|kurs)\b/i.test(t)) return true;
  if (/\b(cuaca|weather)\b/i.test(t)) return true;
  if (/\b(berita|news)\b.{0,20}\b(terbaru|terkini|hari ini|sekarang)?\b/i.test(t)) return true;

  if (
    /\b(btc|bitcoin|eth|ethereum|ondo|tao|xau)\b/i.test(t) &&
    (liveTime || /\b(berapa|harga|price)\b/i.test(t) || t.length < 40)
  ) {
    return true;
  }

  return liveKeyword && liveTime;
}

function isShellIntent(t) {
  return (
    /\b(jalankan|run|eksekusi)\b.{0,20}\b(command|perintah|shell|terminal)\b/i.test(t) ||
    /\b(shell|terminal|bash|cmd)\b/i.test(t) ||
    /\b(list\s+process|ps aux|df -h|free -m|uptime)\b/i.test(t) ||
    /\b(device info|info perangkat|spesifikasi hp|spesifikasi device)\b/i.test(t)
  );
}

/** Backward-compatible helper */
function isRealtimeQuery(text) {
  const intent = classifyIntent(text);
  return intent.type === 'realtime' || intent.type === 'time';
}

function getServerTimeInfo() {
  const now = new Date();
  const id = now.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return {
    iso: now.toISOString(),
    jakarta: id,
  };
}

function buildIntentHintBlock(intent) {
  if (!intent || intent.type === 'general') return '';

  const lines = [
    '',
    `## INTENT TERDETEKSI: ${intent.type.toUpperCase()} (confidence: ${intent.confidence})`,
  ];

  if (intent.hints && intent.hints.length) {
    for (const h of intent.hints) lines.push(`- ${h}`);
  }
  if (intent.preferTools && intent.preferTools.length) {
    lines.push(`- Prefer tools: ${intent.preferTools.join(', ')}`);
  }
  if (intent.blockTools && intent.blockTools.length) {
    lines.push(`- JANGAN pakai: ${intent.blockTools.join(', ')}`);
  }

  if (intent.type === 'status') {
    lines.push(
      '- Untuk status provider/token: arahkan user ke /status atau jelaskan bahwa laporan status tersedia via perintah /status. Jangan search vault.'
    );
  }
  if (intent.type === 'time') {
    lines.push('- Jawab FINAL langsung dari WAKTU SERVER. Jangan tool.');
  }
  if (intent.type === 'realtime') {
    lines.push(
      '- Contoh fetch Binance: {"action":"tool","tool":"fetch","args":{"url":"https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"}}'
    );
  }

  return lines.join('\n');
}

function buildAgentSystemPrompt(
  agentName = 'Paijo',
  ragContextAvailable = false,
  options = {}
) {
  const tools = buildToolManifest();
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const intent = options.intent || { type: 'general' };
  const realtimeMode =
    options.realtimeMode === true || intent.type === 'realtime';
  const timeInfo = getServerTimeInfo();

  let ragHint;
  if (intent.type === 'realtime' || intent.type === 'time' || intent.type === 'status') {
    ragHint =
      '> ⚠️ MODE KHUSUS: Jangan andalkan RAG/vault untuk pertanyaan ini. Ikuti blok INTENT di bawah.';
  } else if (ragContextAvailable) {
    ragHint =
      '> ℹ️ KONTEKS VAULT: Cuplikan vault (RAG) ada di bawah. Gunakan jika relevan dengan catatan/project user. Jangan pakai untuk harga live.';
  } else {
    ragHint = '> ℹ️ Tidak ada konteks vault yang cocok untuk pertanyaan ini.';
  }

  const intentBlock = buildIntentHintBlock(intent);

  return [
    `Kamu adalah ${agentName}, AI assistant personal dengan akses vault Obsidian dan internet (tool fetch).`,
    'Tugasmu: pilih tool yang tepat atau jawab langsung. Selalu sesuaikan sumber dengan jenis pertanyaan.',
    '',
    `## WAKTU SERVER (Asia/Jakarta)`,
    `- Sekarang: ${timeInfo.jakarta}`,
    `- ISO: ${timeInfo.iso}`,
    'Untuk "hari ini tanggal berapa / jam berapa" → boleh jawab dari waktu server ini tanpa tool.',
    '',
    ragHint,
    intentBlock,
    '',
    '## STRUKTUR RESPON (SANGAT PENTING!)',
    'Kamu WAJIB merespon DALAM FORMAT JSON VALID saja.',
    'Jangan menambahkan teks di luar JSON.',
    '',
    'Format panggil tool:',
    '{',
    '  "action": "tool",',
    '  "tool": "<nama_tool>",',
    '  "args": { ... },',
    '  "thought": "<alasan_singkat>"',
    '}',
    '',
    'Format jawaban akhir:',
    '{',
    '  "action": "final",',
    '  "reply": "<jawaban_lengkap>"',
    '}',
    '',
    '## DAFTAR TOOLS:',
    toolList,
    '',
    '## PRIORITAS SUMBER DATA (WAJIB):',
    '1. Data LIVE (harga pair exchange / kripto / XAU, cuaca, berita) → tool **fetch**.',
    '   Pair *USDT/*BUSD (contoh XAUUSDT, BTCUSDT, ETHUSDT) → WAJIB Binance spot ticker:',
    '   https://api.binance.com/api/v3/ticker/price?symbol=XAUUSDT',
    '   Gunakan SYMBOL PERSIS yang diminta user. Jangan substitusi ke token lain (XAUUSDT ≠ XAUT/PAXG).',
    '2. Tanggal/jam "hari ini" → pakai WAKTU SERVER (final), tidak perlu shell/fetch.',
    '3. Status API/token/kuota → bukan vault; arahkan ke /status.',
    '4. Isi vault / note / project user → obsidian-search / obsidian-read / RAG.',
    '5. Perintah sistem lokal → shell — HANYA jika perlu dan BUKAN untuk browsing web.',
    '',
    '## ATURAN WAJIB:',
    '1. JANGAN pakai shell untuk cek harga, download web, curl/wget ke API publik, atau cek tanggal. Pakai fetch atau waktu server.',
    '2. JANGAN mengarang harga/kurs/berita. Kalau butuh angka terkini → fetch dulu, baru final.',
    '3. JANGAN mengandalkan cuplikan RAG vault untuk harga "saat ini".',
    '4. Jika user minta buka/baca/cari note di vault → obsidian-* dulu.',
    '5. JANGAN mengarang isi note. Cari/baca dulu lewat tool.',
    '6. Satu action shell = satu command sederhana. Dilarang &&, ||, ;, |, >, <, backtick, $().',
    '7. Setelah fetch BERHASIL (dapat JSON/harga), WAJIB langsung action "final". JANGAN fetch ulang URL yang sama atau sumber lain kecuali hasil error/gagal.',
    '8. JANGAN panggil tool yang sama dengan args yang sama dua kali. Satu fetch sukses = langsung jawab.',
    '9. Jawaban harga: sebutkan simbol, harga, sumber URL, dan waktu server.',
    '10. PROGRESS / KNOWLEDGE LOG: jika user bilang catat progres / log ini / update knowledge tentang JongosAIFree/Paijo/Yanto → '
      + 'append ke note path \"04 Knowledge/JongosAIFree.md\". '
      + 'Args WAJIB: {\"note\":\"04 Knowledge/JongosAIFree.md\",\"content\":\"- [YYYY-MM-DD] ...\"} '
      + '(field note ATAU path, keduanya diterima). '
      + 'Jika note belum ada: obsidian-create dulu dengan note+content yang sama, lalu append. '
      + 'Tanggal dari WAKTU SERVER. Jangan buat Progress Log.md terpisah.',
    '11. Jangan mengarang isi vault. Jika RAG tidak relevan, bilang tidak menemukan di vault lalu tawarkan search.',
  ].join('\n');
}

function parseAgentResponse(rawText) {
  let cleaned = String(rawText || '').trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned
      .replace(/^```[a-z]*\r?\n?/i, '')
      .replace(/\r?\n?```$/i, '')
      .trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fallthrough
      }
    }
    return null;
  }
}

module.exports = {
  buildToolManifest,
  buildAgentSystemPrompt,
  parseAgentResponse,
  isRealtimeQuery,
  getServerTimeInfo,
  classifyIntent,
  isStatusIntent,
  isVaultIntent,
  isRealtimeIntent,
  isTimeOnlyIntent,
  isShellIntent,
  extractTickers,
  isProgressLogIntent,
  extractProgressLogContent,
};
