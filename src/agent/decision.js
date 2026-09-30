const { getSkillManifest } = require('../skills');

function buildToolManifest() {
  return getSkillManifest();
}

function buildAgentSystemPrompt(agentName = 'Paijo') {
  const tools = buildToolManifest();
  const toolList = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join('\n');

  return [
    `Kamu adalah ${agentName}, AI assistant yang memiliki akses ke berbagai tools.`,
    'Tugasmu adalah membantu user dengan cara memanggil tool yang tepat atau memberikan jawaban langsung.',
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
    '## ATURAN:',
    '1. Jika user meminta informasi dari vault Obsidian, gunakan obsidian-read, obsidian-search, obsidian-tags, dll.',
    '2. Jika user meminta perubahan pada vault Obsidian, gunakan obsidian-create, obsidian-update, obsidian-move, obsidian-delete, atau obsidian-normalize.',
    '3. Jangan pernah mengarang isi note yang tidak ada. Cari atau baca dulu!',
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
