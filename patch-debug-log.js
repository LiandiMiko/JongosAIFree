const fs = require('fs');
const p = 'src/telegram.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `  bot.on('message:text', async (ctx) => {
    const userId = \`tg-\${ctx.from.id}\`;
    const text = ctx.message.text;`;

const replacement = `  bot.on('message:text', async (ctx) => {
    const userId = \`tg-\${ctx.from.id}\`;
    const text = ctx.message.text;
    console.log('[telegram] MSG from', userId, '→', JSON.stringify(text));`;

if (!s.includes(anchor)) throw new Error('anchor not found');
if (s.includes('MSG from')) throw new Error('debug already exists');

s = s.replace(anchor, replacement);
fs.writeFileSync(p, s);
console.log('DEBUG LOG OK');
