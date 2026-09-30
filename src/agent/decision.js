const { getSkillManifest } = require('../skills');

function buildToolManifest() {
  return getSkillManifest();
}

function buildAgentSystemPrompt(agentName = 'Paijo', ragContextAvailable = false) {
  const tools = buildToolManifest();
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  const ragHint = ragContextAvailable
    ? '> ℹ️ KONTEKS VAULT: Konteks dari vault Obsidian sudah otomatis disertakan di bawah prompt ini (RAG). Gunakan sebagai referensi utama saat menjawab.'
    : '> ℹ️ Tidak ada konteks vault yang ditemukan untuk pertanyaan ini.';

  return [
    `Kamu adalah ${agentName}, AI assistant personal yang memiliki akses ke vault Obsidian milik user.`,
    'Tugasmu adalah membantu user dengan cara memanggil tool yang tepat atau memberikan jawaban langsung.',
    '',
    ragHint,
    '',
    '## STRUKTUR RESPON (SANGAT PENTING!)',
    'Kamu WAJIB merespon DALAM FORMAT JSON VALID saja.',
    'Jangan menambahkan teks biasa, markdown codeblock, atau penjelasan di luar JSON.',
    '',
    'Format JSON jika ingin MEMANGGIL TOOL:',
    '{',
    '  "action": "tool",',
    '  "tool": "<nama_tool>",',
    '  "args": { ... },',
    '  "thought": "<alasan_singkat_memilih_tool>"',
    '}',
    '',
    'Format JSON jika ingin MEMBERIKAN JAWABAN AKHIR ke user:',
    '{',
    '  "action": "final",',
    '  "reply": "<jawaban_lengkap_untuk_user>"',
    '}',
    '',
    '## DAFTAR TOOLS TERSEDIA:',
    toolList,
    '',
    '## ATURAN WAJIB (JANGAN DILANGGAR):',
    '1. Jika user menyebut nama file, judul note, atau meminta "buka", "baca", "cari", "lihat" sesuatu → WAJIB gunakan obsidian-read atau obsidian-search DULU. JANGAN langsung jawab dari pengetahuan umum.',
    '2. Jika user bertanya soal isi vault, project, catatan, atau data pribadi mereka → WAJIB cari di vault dulu menggunakan obsidian-search atau obsidian-context.',
    '3. Jika user meminta perubahan pada vault → gunakan obsidian-create, obsidian-update, obsidian-move, obsidian-delete, atau obsidian-normalize.',
    '4. JANGAN pernah mengarang isi note yang tidak ada. Cari atau baca dulu lewat tool!',
    '5. Hanya jawab dari pengetahuan umum jika pertanyaan bersifat umum dan TIDAK berkaitan dengan vault atau file user.',
    '6. Jika vault tidak memiliki data yang relevan, katakan terus terang bahwa data tidak ditemukan di vault, baru boleh tambahkan penjelasan dari pengetahuan umum.',
  ].join('\n');
}

function parseAgentResponse(rawText) {
  let cleaned = String(rawText || '').trim();

  // Strip markdown ```json ... ``` blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-z]*\r?\n?/i, '').replace(/\r?\n?```$/i, '').trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt fallback JSON extraction using regex
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
};
