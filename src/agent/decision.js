const { getSkillManifest } = require('../skills');

function buildToolManifest() {
  return getSkillManifest();
}

/** Pertanyaan yang butuh data live (internet / jam server), bukan vault. */
function isRealtimeQuery(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;

  const liveIntent =
    /\b(harga|price|kurs|cuaca|weather|berita|news|ticker|spot)\b/i.test(t) ||
    /\b(saat ini|hari ini|sekarang|real[\s-]?time|terkini|terbaru|live)\b/i.test(t) ||
    /\b(btc|bitcoin|eth|ethereum|usdt|ondo|tao|bittensor|crypto|kripto|saham|stock)\b/i.test(
      t
    ) ||
    /\b(tanggal|jam)\b.{0,40}\b(berapa|sekarang|hari ini)\b/i.test(t) ||
    /\b(berapa).{0,40}\b(harga|tanggal|jam)\b/i.test(t);

  // Kecuali jelas minta isi vault
  const vaultIntent =
    /\b(vault|obsidian|note|catatan|baca file|buka note)\b/i.test(t);

  return liveIntent && !vaultIntent;
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

function buildAgentSystemPrompt(
  agentName = 'Paijo',
  ragContextAvailable = false,
  options = {}
) {
  const tools = buildToolManifest();
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const realtimeMode = options.realtimeMode === true;
  const timeInfo = getServerTimeInfo();

  const ragHint = realtimeMode
    ? '> ⚠️ MODE REAL-TIME: Pertanyaan ini butuh data terkini. JANGAN andalkan RAG/vault untuk harga, berita, cuaca, atau fakta "saat ini". WAJIB pakai tool fetch ke sumber online. Tanggal/jam boleh dari waktu server di bawah.'
    : ragContextAvailable
      ? '> ℹ️ KONTEKS VAULT: Cuplikan vault (RAG) ada di bawah. Gunakan jika relevan dengan pertanyaan tentang catatan/project user. Jangan pakai untuk harga live.'
      : '> ℹ️ Tidak ada konteks vault yang cocok untuk pertanyaan ini.';

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
    '1. Data LIVE (harga kripto/saham, cuaca, berita, "saat ini", "hari ini" selain isi vault) → tool **fetch** ke URL API/situs. CONTOH harga Binance:',
    '   {"action":"tool","tool":"fetch","args":{"url":"https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT"}}',
    '   Untuk beberapa simbol, fetch satu per satu atau endpoint yang sesuai.',
    '2. Tanggal/jam "hari ini" → pakai WAKTU SERVER di atas (final), tidak perlu shell/fetch.',
    '3. Isi vault / note / project user → obsidian-search / obsidian-read / RAG.',
    '4. Perintah sistem lokal (list file OS, process) → shell — HANYA jika benar-benar perlu dan BUKAN untuk browsing web.',
    '',
    '## ATURAN WAJIB:',
    '1. JANGAN pakai shell untuk cek harga, download web, curl ke API publik, atau "tanggal". Pakai fetch atau waktu server.',
    '2. JANGAN mengarang harga/kurs/berita. Kalau butuh angka terkini → fetch dulu, baru final.',
    '3. JANGAN mengandalkan cuplikan RAG vault untuk harga crypto "saat ini" (data vault bisa usang).',
    '4. Jika user minta buka/baca/cari note di vault → obsidian-* dulu.',
    '5. JANGAN mengarang isi note. Cari/baca dulu lewat tool.',
    '6. Status API/token/kuota agent → bukan isi vault; arahkan ke /status.',
    '7. Setelah fetch berhasil, berikan final yang jelas (angka + sumber URL + waktu server).',
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
};
