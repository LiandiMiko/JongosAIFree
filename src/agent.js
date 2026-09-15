const { callLLM, PROVIDERS, getModels } = require('./llm');
const { getHistory, addMessage, clearHistory } = require('./memory');
const { runSkill, listSkills } = require('./skills');

function buildSystemPrompt(config) {
  const date = new Date().toLocaleDateString('id-ID', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return {
    role: 'system',
    content: [
      `Kamu adalah ${config.agentName || 'Clawd'}, asisten AI yang ramah dan membantu.`,
      `Provider yang sedang dipakai: ${config.provider || 'gemini'}.`,
      `Model yang sedang dipakai: ${config.model}.`,
      `Jawab dalam bahasa Indonesia kecuali diminta lain.`,
      `Kamu bisa akses perangkat (baterai, lokasi, kamera, dll) jika user minta.`,
      `Hari ini ${date}.`,
    ].join(' '),
  };
}

function introText(config) {
  const provider =
    (config.provider || 'gemini').toLowerCase();

  const providerInfo = PROVIDERS[provider];

  return [
    `Halo! Saya **${config.agentName || 'Clawd'}**.`,
    '',
    `• Provider : \`${providerInfo?.name || provider}\``,
    `• Model    : \`${config.model}\``,
    '',
    'Ketik pesan untuk chat.',
    '',
    'Perintah:',
    '/help',
    '/provider',
    '/model',
    '/models',
    '/reset',
    '/skills',
    '/device',
  ].join('\n');
}

async function processMessage(userId, text, config) {
  const trimmed = text.trim();

  if (trimmed === '/start') {
    return introText(config);
  }

  if (trimmed === '/help') {
    return [
      '/help     — Bantuan',
      '/provider — Lihat/ganti provider',
      '/model    — Lihat/ganti model',
      '/models   — Daftar model provider aktif',
      '/skills   — Daftar skill',
      '/device   — Akses perangkat',
      '/reset    — Hapus memory/history',
      `Provider aktif: \`${config.provider || 'gemini'}\``,
      `Model aktif: \`${config.model}\``,
    ].join('\n');
  }

  if (trimmed === '/provider') {
    const activeProvider =
      (config.provider || 'gemini').toLowerCase();

    const lines = Object.entries(PROVIDERS).map(
      ([key, info], index) => {
        const mark =
          key === activeProvider ? ' ← aktif' : '';

        return `${index + 1}. \`${key}\` — ${info.name}${mark}`;
      }
    );

    return [
      '*Provider tersedia*',
      '',
      ...lines,
      '',
      'Ganti provider:',
      '`/provider gemini`',
      '`/provider openrouter`',
      '`/provider mistral`',
    ].join('\n');
  }

  if (trimmed.startsWith('/provider ')) {
    const provider = trimmed
      .slice('/provider '.length)
      .trim()
      .toLowerCase();

    if (!PROVIDERS[provider]) {
      return [
        `Provider \`${provider}\` tidak ditemukan.`,
        '',
        `Provider tersedia: ${Object.keys(PROVIDERS)
          .map((p) => `\`${p}\``)
          .join(', ')}`,
      ].join('\n');
    }

    const models = getModels(provider);

    config.provider = provider;

    if (!models.includes(config.model)) {
      config.model = models[0];
    }

    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(
      __dirname,
      '..',
      'config.json'
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify(config, null, 2)
    );

    return [
      `✅ Provider diganti ke **${PROVIDERS[provider].name}**.`,
      '',
      `Model aktif: \`${config.model}\``,
      '',
      'Gunakan `/models` untuk melihat model yang tersedia.',
    ].join('\n');
  }

  if (trimmed === '/reset') {
    await clearHistory(userId);
    return 'Memory dihapus. Mulai dari awal.\n\n' + introText(config);
  }

  if (trimmed === '/skills') {
    const list = listSkills();
    return `*Loaded Skills*\n\n${list}`;
  }

  if (
    trimmed === '/models' ||
    trimmed === '/model'
  ) {
    const provider =
      (config.provider || 'gemini').toLowerCase();

    const models = getModels(provider);

    const lines = models.map((m, i) => {
      const mark =
        m === config.model ? ' ← aktif' : '';

      return `${i + 1}. \`${m}\`${mark}`;
    });

    return [
      `*Model — ${PROVIDERS[provider]?.name || provider}*`,
      '',
      ...lines,
      '',
      `Provider aktif: \`${provider}\``,
      '',
      'Ganti model:',
      '`/model <model-id>`',
    ].join('\n');
  }

  if (trimmed.startsWith('/model ')) {
    const requestedModel = trimmed
      .slice('/model '.length)
      .trim();

    const provider =
      (config.provider || 'gemini').toLowerCase();

    const models = getModels(provider);

    if (!models.includes(requestedModel)) {
      return [
        `Model \`${requestedModel}\` tidak tersedia untuk provider \`${provider}\`.`,
        '',
        'Gunakan `/models` untuk melihat model yang tersedia.',
      ].join('\n');
    }

    config.model = requestedModel;

    const fs = require('fs');
    const path = require('path');
    const configPath = path.join(
      __dirname,
      '..',
      'config.json'
    );

    fs.writeFileSync(
      configPath,
      JSON.stringify(config, null, 2)
    );

    return [
      `✅ Model diganti ke \`${requestedModel}\`.`,
      '',
      `Provider: \`${provider}\``,
    ].join('\n');
  }  


  // Skill dulu
  const skillResult = await runSkill(trimmed, { userId, config });
  if (skillResult) {
    await addMessage(userId, 'user', trimmed);
    await addMessage(userId, 'assistant', skillResult);
    return skillResult;
  }

  // Bangun messages + history (tetap dibawa saat switch model)
  const history = await getHistory(userId);
  const systemPrompt = buildSystemPrompt(config);
  const messages = [systemPrompt, ...history, { role: 'user', content: trimmed }];

  let reply;
  try {
    reply = await callLLM(messages, config);
  } catch (err) {
    console.error('[agent] LLM error:', err.message);
    return `Terjadi kesalahan: ${err.message}`;
  }

  await addMessage(userId, 'user', trimmed);
  await addMessage(userId, 'assistant', reply);
  return reply;
}

module.exports = { processMessage };
