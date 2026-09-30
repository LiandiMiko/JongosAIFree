const { Bot, InlineKeyboard } = require('grammy');
const {
  runAgent,
  executeApprovedRequest,
  continueAgentAfterApproval,
} = require('./agent-loop');
const {
  approveRequest,
  denyRequest,
} = require('./approval');

/**
 * Start the Telegram bot gateway
 * @param {Object} config - App configuration
 */
const AGENT_TRIGGERS = [
  // Obsidian
  /\bnote\b/i, /\bcatat\b/i, /\bcari\b/i, /\bbaca\b/i,
  /\bbuka\b/i, /\bbukain\b/i, /\bshow\b/i, /\bdisplay\b/i,
  /\bfile\b/i, /\bdokumen\b/i, /\btampilkan\b/i, /\bliat\b/i,
  /\bobsidian\b/i, /\bvault\b/i, /\btag\b/i, /\bbacklink\b/i,
  /\bknowledge\b/i, /\bprogres\b/i, /\bprogress\b/i,
  /\bfolder\b/i, /\bstruktur\b/i, /\btree\b/i, /\bdirektori\b/i,
  /\blist.*folder\b/i, /\bfolder.*apa\b/i, /\bisi folder\b/i,
  // File
  /\bread:/i, /\bbaca file\b/i, /\bwrite:/i,
  // Shell
  /\bjalankan\b/i, /\bshell\b/i, /\brun:/i, /\bcommand\b/i,
  // Device
  /\bbaterai\b/i, /\bbattery\b/i, /\bdevice\b/i, /\binfo hp\b/i,
  // Skills
  /\bskill\b/i, /\bclawd-scan\b/i, /\bping\b/i,

  // Real-time data (butuh fetch)
  /\bberita\b/i, /\bnews\b/i,
  /\bcuaca\b/i, /\bweather\b/i,
  /\bharga\b/i, /\bprice\b/i, /\bkurs\b/i,
  /\bbtc\b/i, /\bbitcoin\b/i, /\beth\b/i, /\bcrypto\b/i,
  /\bsaham\b/i, /\bstock\b/i,
  /\bskor\b/i, /\bhasil pertandingan\b/i,
  /\bterbaru\b/i, /\bterkini\b/i, /\bhari ini\b/i,
  /\bsekarang\b/i, /\brealtime\b/i, /\breal-time\b/i,
  /\bcek di internet\b/i, /\bcari di internet\b/i, /\bgoogle\b/i,
  /\burl\b/i, /\bwebsite\b/i, /\blink\b/i,
  /https?:\/\//i,
];

function needsAgentLoop(text) {
  const t = text.trim();
  if (!t) return false;
  // Slash command
  if (t.startsWith('/')) return false;
  // Trigger words
  return AGENT_TRIGGERS.some(re => re.test(t));
}

function startTelegram(config) {
  if (!config.telegramToken) {
    console.log(
      '[telegram] No token configured — Telegram bot disabled'
    );
    return;
  }

  const bot = new Bot(config.telegramToken);

  // ==============================
  // Normal text message
  // ==============================
  // === Handler: file document (import chat) ===
  bot.on('message:document', async (ctx) => {
    const userId = `tg-${ctx.from.id}`;
    const doc = ctx.message.document;

    console.log(`[telegram] DOC from ${userId}: ${doc.file_name} (${doc.file_size} bytes)`);

    try {
      await ctx.replyWithChatAction('typing');

      const allowedExt = ['.json', '.md', '.txt'];
      const ext = (doc.file_name || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';

      if (!allowedExt.includes(ext)) {
        await ctx.reply(`❌ Format tidak didukung: ${ext}\nHanya: .json, .md, .txt`);
        return;
      }

      if (doc.file_size > 20 * 1024 * 1024) {
        await ctx.reply('❌ File terlalu besar (max 20 MB).');
        return;
      }

      const file = await ctx.api.getFile(doc.file_id);
      const token = config.telegramToken;
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

      const fs = require('fs');
      const path = require('path');
      const https = require('https');

      const inbox = path.join(__dirname, '..', 'data', 'imports', 'inbox');
      fs.mkdirSync(inbox, { recursive: true });

      const safeName = String(doc.file_name || 'import.json').replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(inbox, `${Date.now()}-${safeName}`);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(destPath);
        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`download failed: HTTP ${res.statusCode}`));
            return;
          }
          res.pipe(ws);
          ws.on('finish', () => ws.close(resolve));
          ws.on('error', reject);
        }).on('error', reject);
      });

      console.log(`[telegram] File saved: ${destPath}`);

      // Import via script
      const { execFile } = require('child_process');
      const util = require('util');
      const execFileAsync = util.promisify(execFile);

      const scriptPath = path.join(__dirname, '..', 'scripts', 'import-ai-chats.js');
      const { stdout, stderr } = await execFileAsync('node', [scriptPath, '--file', destPath], {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      console.log('[telegram] Import output:\n' + stdout);
      if (stderr) console.log('[telegram] Import stderr:', stderr);

      // Parse hasil dari stdout
      const lines = stdout.split('\n').filter(Boolean);
      const summary = lines.find((l) => l.includes('format=')) || '';

      await ctx.reply(
        [
          '✅ *Import selesai*',
          '',
          `File: \`${safeName}\``,
          summary ? `${summary.trim()}` : '',
          '',
          'Cek di vault: \`07 Imported/AI Chats/\`',
        ].filter(Boolean).join('\n'),
        { parse_mode: 'Markdown' }
      );

    } catch (err) {
      console.error('[telegram] Import error:', err.message);
      await ctx.reply(`❌ Import gagal: ${err.message}`);
    }
  });
  // === end document handler ===

  bot.on('message:text', async (ctx) => {
    const userId = `tg-${ctx.from.id}`;
    const text = ctx.message.text;
    console.log('[telegram] MSG from', userId, '→', JSON.stringify(text));

    // /status already wrapped
    // === /status command intercept (before LLM) ===
    try {
      if (text.trim() === '/status') {
        const { getAllProviderStatus } = require('./llm-status');
        const all = getAllProviderStatus();

        if (!all.length) {
          await ctx.reply('📊 Belum ada data usage. Coba kirim pesan dulu.');
          return;
        }

        const esc = (v) => String(v == null ? '' : v)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
        const lines = ['📊 <b>LLM Usage Status</b>', ''];

        for (const e of all) {
          const u = e.usage || {};
          const keyLabel = e.keyId != null ? ` (key #${e.keyId})` : '';
          lines.push('<b>' + esc(e.provider) + ' / ' + esc(e.model) + esc(keyLabel) + '</b>');
          lines.push('• Status        : <code>' + esc(e.status) + '</code>');
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
          if (e.resetAt)    lines.push('• Reset at      : ' + esc(e.resetAt));
          if (e.lastError)  lines.push('• Last error    : ' + esc(e.lastError));
          lines.push('');
        }

        await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
        return;
      }

    } catch (e) {
      console.error('[telegram] /status error:', e.message);
      await ctx.reply('❌ /status error: ' + e.message).catch(() => {});
      return;
    }
    // === end /status ===

    try {
      await ctx.replyWithChatAction('typing');

      // === Smart routing: chat biasa → local, butuh tool → agent loop ===
      if (!needsAgentLoop(text)) {
        console.log('[telegram] Fast-chat mode (local LLM, no tools)');
        const { callLLM } = require('./llm');
        const { getHistory } = require('./memory');

        const fullHistory = await getHistory(userId);

        // Fast-chat: ambil 6 pesan terakhir + potong tiap pesan max 300 char
        const MAX_TURNS = 6;
        const MAX_CONTENT_CHARS = 300;
        const history = fullHistory.slice(-MAX_TURNS).map((m) => ({
          role: m.role,
          content: String(m.content || '').slice(0, MAX_CONTENT_CHARS),
        }));

        console.log(`[telegram] Fast-chat history: ${fullHistory.length} → ${history.length} msgs`);

        const today = new Date().toLocaleDateString('id-ID', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        const isoDate = new Date().toISOString().slice(0, 10);

        const systemPrompt = [
          `Kamu adalah ${config.agentName || 'Paijo'}, asisten AI yang ramah dan jujur.`,
          `Hari ini: ${today} (ISO: ${isoDate}).`,
          '',
          'ATURAN:',
          '1. Jawab singkat, natural, dalam bahasa Indonesia.',
          '2. JANGAN mengarang fakta. Kalau tidak tahu, katakan tidak tahu.',
          '3. JANGAN mengarang harga, kurs, berita, skor, atau data real-time apapun.',
          '4. Untuk pertanyaan tentang data terkini (harga crypto, berita, cuaca), katakan bahwa kamu tidak punya akses internet dan sarankan user cek sumber langsung.',
          '5. Gunakan tanggal di atas kalau ditanya tentang hari/tanggal/tahun.',
        ].join('\n');

        const messages = [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: text },
        ];

        const reply = await callLLM(messages, config);

        await ctx.reply(reply);
        return;
      }
      // === end Smart routing ===

      const result = await runAgent(
        text,
        config,
        { userId, source: 'telegram' }
      );

      if (result.status === 'answered') {
        await ctx.reply(result.answer);
        return;
      }

      if (result.status === 'approval_required') {
        const approvalText = [
          '⚠️ APPROVAL REQUIRED',
          '',
          `Tool: ${result.tool}`,
          `Risk: ${result.policy.label}`,
          '',
          'Arguments:',
          JSON.stringify(result.args, null, 2),
          '',
          'Apakah kamu mengizinkan tool ini dijalankan?',
        ].join('\n');

        const keyboard = new InlineKeyboard()
          .text(
            '🟢 Allow',
            `approve:${result.requestId}`
          )
          .text(
            '🔴 Deny',
            `deny:${result.requestId}`
          );

        await ctx.reply(approvalText, {
          reply_markup: keyboard,
        });

        return;
      }

      if (result.status === 'error') {
        await ctx.reply(
          `❌ ${result.message || 'Terjadi kesalahan.'}`
        );
        return;
      }

      await ctx.reply(
        '❌ Response agent tidak dikenali.'
      );

    } catch (err) {
      console.error(
        '[telegram] Error handling message:',
        err.message
      );

      await ctx.reply(
        'Something went wrong. Try again.'
      );
    }
  });

  // ==============================
  // APPROVE
  // ==============================
  bot.callbackQuery(
    /^approve:(.+)$/,
    async (ctx) => {
      const requestId = ctx.match[1];
      const userId = `tg-${ctx.from.id}`;

      try {
        const approval = approveRequest(
          requestId,
          userId
        );

        if (!approval.success) {
          await ctx.answerCallbackQuery({
            text: approval.reason,
            show_alert: true,
          });
          return;
        }

        await ctx.answerCallbackQuery({
          text: 'Approved',
        });

        await ctx.editMessageText(
          [
            '🟢 APPROVED',
            '',
            `Tool: ${approval.request.tool}`,
            `Risk: ${approval.request.policy.label}`,
            '',
            'Executing tool...',
          ].join('\n')
        );

        const result =
          await executeApprovedRequest(
            requestId,
            userId,
            { userId, config, source: 'telegram' }
          );

	          if (result.status === 'executed') {
          const continuation =
            await continueAgentAfterApproval(
              result,
              config,
              { userId, source: 'telegram' }
            );

          if (continuation.status === 'answered') {
            await ctx.reply(
              continuation.answer
            );
            return;
          }

          if (continuation.status === 'approval_required') {
            const approvalText = [
              '🔐 Additional approval required',
              '',
              `Tool: ${continuation.tool}`,
              `Risk: ${continuation.policy.label}`,
              '',
              'Arguments:',
              JSON.stringify(
                continuation.args,
                null,
                2
              ),
              '',
              'Apakah kamu mengizinkan tool ini dijalankan?',
            ].join('\n');

            const keyboard = new InlineKeyboard()
              .text(
                '🟢 Allow',
                `approve:${continuation.requestId}`
              )
              .text(
                '🔴 Deny',
                `deny:${continuation.requestId}`
              );

            await ctx.reply(
              approvalText,
              {
                reply_markup: keyboard,
              }
            );
            return;
          }

          await ctx.reply(
            `❌ ${continuation.message || 'Continuation failed.'}`
          );
        } else {
          await ctx.reply(
            `❌ ${result.message || 'Tool execution failed.'}`
          );
        }

      } catch (err) {
        console.error(
          '[telegram] Approval error:',
          err.message
        );

        await ctx.reply(
          `❌ Approval execution error: ${err.message}`
        );
      }
    }
  );

  // ==============================
  // DENY
  // ==============================
  bot.callbackQuery(
    /^deny:(.+)$/,
    async (ctx) => {
      const requestId = ctx.match[1];
      const userId = `tg-${ctx.from.id}`;

      try {
        const denial = denyRequest(
          requestId,
          userId
        );

        if (!denial.success) {
          await ctx.answerCallbackQuery({
            text: denial.reason,
            show_alert: true,
          });
          return;
        }

        await ctx.answerCallbackQuery({
          text: 'Denied',
        });

        await ctx.editMessageText(
          [
            '🔴 DENIED',
            '',
            `Tool: ${denial.request.tool}`,
            '',
            'Tool tidak dijalankan.',
          ].join('\n')
        );

      } catch (err) {
        console.error(
          '[telegram] Deny error:',
          err.message
        );

        await ctx.reply(
          `❌ Deny error: ${err.message}`
        );
      }
    }
  );

  // ==============================
  // Global error handler
  // ==============================
  bot.catch((err) => {
    console.error(
      '[telegram] Bot error:',
      err.message || err
    );
  });

  bot.start();

  console.log(
    '[telegram] Bot started and listening'
  );
}

module.exports = { startTelegram };
