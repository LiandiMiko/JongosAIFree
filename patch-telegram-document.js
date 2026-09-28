const fs = require('fs');
const p = 'src/telegram.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `  bot.on('message:text', async (ctx) => {`;

const handler = `  // === Handler: file document (import chat) ===
  bot.on('message:document', async (ctx) => {
    const userId = \`tg-\${ctx.from.id}\`;
    const doc = ctx.message.document;

    console.log(\`[telegram] DOC from \${userId}: \${doc.file_name} (\${doc.file_size} bytes)\`);

    try {
      await ctx.replyWithChatAction('typing');

      const allowedExt = ['.json', '.md', '.txt'];
      const ext = (doc.file_name || '').toLowerCase().match(/\\.[a-z0-9]+$/)?.[0] || '';

      if (!allowedExt.includes(ext)) {
        await ctx.reply(\`❌ Format tidak didukung: \${ext}\\nHanya: .json, .md, .txt\`);
        return;
      }

      if (doc.file_size > 20 * 1024 * 1024) {
        await ctx.reply('❌ File terlalu besar (max 20 MB).');
        return;
      }

      const file = await ctx.api.getFile(doc.file_id);
      const token = config.telegramToken;
      const url = \`https://api.telegram.org/file/bot\${token}/\${file.file_path}\`;

      const fs = require('fs');
      const path = require('path');
      const https = require('https');

      const inbox = path.join(__dirname, '..', 'data', 'imports', 'inbox');
      fs.mkdirSync(inbox, { recursive: true });

      const safeName = String(doc.file_name || 'import.json').replace(/[^a-zA-Z0-9._-]/g, '_');
      const destPath = path.join(inbox, \`\${Date.now()}-\${safeName}\`);

      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(destPath);
        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(\`download failed: HTTP \${res.statusCode}\`));
            return;
          }
          res.pipe(ws);
          ws.on('finish', () => ws.close(resolve));
          ws.on('error', reject);
        }).on('error', reject);
      });

      console.log(\`[telegram] File saved: \${destPath}\`);

      // Import via script
      const { execFile } = require('child_process');
      const util = require('util');
      const execFileAsync = util.promisify(execFile);

      const scriptPath = path.join(__dirname, '..', 'scripts', 'import-ai-chats.js');
      const { stdout, stderr } = await execFileAsync('node', [scriptPath, '--file', destPath], {
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      console.log('[telegram] Import output:\\n' + stdout);
      if (stderr) console.log('[telegram] Import stderr:', stderr);

      // Parse hasil dari stdout
      const lines = stdout.split('\\n').filter(Boolean);
      const summary = lines.find((l) => l.includes('format=')) || '';

      await ctx.reply(
        [
          '✅ *Import selesai*',
          '',
          \`File: \\\`\${safeName}\\\`\`,
          summary ? \`\${summary.trim()}\` : '',
          '',
          'Cek di vault: \\\`07 Imported/AI Chats/\\\`',
        ].filter(Boolean).join('\\n'),
        { parse_mode: 'Markdown' }
      );

    } catch (err) {
      console.error('[telegram] Import error:', err.message);
      await ctx.reply(\`❌ Import gagal: \${err.message}\`);
    }
  });
  // === end document handler ===

  bot.on('message:text', async (ctx) => {`;

if (!s.includes(anchor)) throw new Error('message:text anchor not found');
if (s.includes('message:document')) throw new Error('already patched');
s = s.replace(anchor, handler);

fs.writeFileSync(p, s);
console.log('TELEGRAM DOCUMENT HANDLER OK');
