const fs = require('fs');
const p = 'src/telegram.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `    const text = ctx.message.text;

    try {`;

const replacement = `    const text = ctx.message.text;

    // === /status command intercept (before LLM) ===
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
        lines.push('• Status        : \`' + e.status + '\`');
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

      await ctx.reply(lines.join('\\n'), { parse_mode: 'Markdown' });
      return;
    }
    // === end /status ===

    try {`;

if (!s.includes(anchor)) throw new Error('Anchor telegram.js tidak ditemukan');
if (s.includes("text.trim() === '/status'")) throw new Error('Telegram /status already patched');

s = s.replace(anchor, replacement);
fs.writeFileSync(p, s);
console.log('TELEGRAM STATUS OK');
