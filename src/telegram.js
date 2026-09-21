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

        const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
        const lines = ['📊 *LLM Usage Status*', ''];

        for (const e of all) {
          const u = e.usage || {};
          lines.push('*' + e.provider + ' / ' + e.model + '*');
          lines.push('• Status        : `' + e.status + '`');
          lines.push('• Requests      : ' + fmt(u.requests));
          lines.push('• Input tokens  : ' + fmt(u.inputTokens));
          lines.push('• Output tokens : ' + fmt(u.outputTokens));
          lines.push('• Total tokens  : ' + fmt(u.totalTokens));
          if (e.limit !== null && e.limit !== undefined) {
            lines.push('• Quota limit   : ' + fmt(e.limit));
            lines.push('• Quota remain  : ' + fmt(e.remaining));
            lines.push('• Quota used    : ' + fmt(e.used));
          }
          if (e.retryAfter) lines.push('• Retry after   : ' + e.retryAfter + 's');
          if (e.resetAt)    lines.push('• Reset at      : ' + e.resetAt);
          if (e.lastError)  lines.push('• Last error    : ' + e.lastError);
          lines.push('');
        }

        await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
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

      const result = await runAgent(
        text,
        config,
        [],
        { userId }
      );

      if (result.status === 'answered') {
        await ctx.reply(result.content);
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
            { userId }
          );

	          if (result.status === 'executed') {
          const continuation =
            await continueAgentAfterApproval(
              result,
              config,
              { userId }
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
