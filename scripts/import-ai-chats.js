#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME;
const PROJECT = path.join(HOME, 'clawd-agent');
const INBOX = path.join(PROJECT, 'data', 'imports', 'inbox');
const PROCESSED = path.join(PROJECT, 'data', 'imports', 'processed');
const VAULT = process.env.OBSIDIAN_VAULT || path.join(PROJECT, 'memory', 'second-brain');
const OUT_ROOT = path.join(VAULT, '07 Imported', 'AI Chats');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SINGLE_FILE = args.includes('--file')
  ? args[args.indexOf('--file') + 1]
  : null;

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

function slugify(str, max = 60) {
  return String(str || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, max)
    .replace(/^-|-$/g, '');
}

function dateSlug(dateStr) {
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return new Date().toISOString().slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function detectFormat(content, filename) {
  if (filename.endsWith('.md')) return 'markdown';
  if (filename.endsWith('.txt')) return 'plaintext';
  if (filename.endsWith('.json')) {
    try {
      const data = JSON.parse(content);
      if (Array.isArray(data) && data[0]?.mapping) return 'chatgpt-v2';
      if (Array.isArray(data) && data[0]?.title && data[0]?.mapping) return 'chatgpt-v2';
      if (data.conversations && Array.isArray(data.conversations)) return 'chatgpt';
      if (Array.isArray(data) && data[0]?.title && data[0]?.create_time) return 'chatgpt';
      if (data.activity || (Array.isArray(data) && data[0]?.header)) return 'gemini';
      if (Array.isArray(data) && data[0]?.role) return 'openai-messages';
      return 'json-unknown';
    } catch {
      return 'json-invalid';
    }
  }
  return 'unknown';
}

function parseChatGPT(content) {
  const data = JSON.parse(content);
  const conversations = Array.isArray(data) ? data : (data.conversations || []);
  const notes = [];

  for (const conv of conversations) {
    const title = conv.title || 'Untitled';
    const createTime = conv.create_time
      ? new Date(conv.create_time * 1000).toISOString()
      : new Date().toISOString();

    const messages = [];

    if (conv.mapping) {
      const nodes = Object.values(conv.mapping);
      const sorted = nodes
        .filter((n) => n.message)
        .map((n) => n.message)
        .sort((a, b) => (a.create_time || 0) - (b.create_time || 0));

      for (const msg of sorted) {
        const role = msg.author?.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const content = extractChatGPTContent(msg.content);
        if (!content) continue;
        messages.push({ role, content });
      }
    } else if (Array.isArray(conv.messages)) {
      for (const msg of conv.messages) {
        messages.push({
          role: msg.role || 'user',
          content: String(msg.content || '').trim(),
        });
      }
    }

    if (messages.length === 0) continue;
    notes.push({ source: 'chatgpt', title, date: createTime, messages });
  }
  return notes;
}

function extractChatGPTContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();
  if (content.parts) {
    return content.parts
      .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
      .join('\n')
      .trim();
  }
  if (content.text) return String(content.text).trim();
  return '';
}

function parseGemini(content) {
  const data = JSON.parse(content);
  const entries = Array.isArray(data) ? data : (data.activity || []);
  const notes = [];
  const conversations = new Map();

  for (const entry of entries) {
    const title = entry.title || 'Gemini Chat';
    const time = entry.time || new Date().toISOString();

    let userPrompt = '';
    let aiResponse = '';

    if (Array.isArray(entry.subtitles)) {
      for (const sub of entry.subtitles) {
        if (sub.name === 'User prompt' || sub.name === 'Prompt') {
          userPrompt = sub.value || '';
        } else if (sub.name === 'Response' || sub.name === 'AI response') {
          aiResponse = sub.value || '';
        }
      }
    }
    if (!userPrompt && !aiResponse) {
      userPrompt = entry.details?.[0]?.content || '';
    }

    if (!conversations.has(title)) {
      conversations.set(title, { title, date: time, messages: [] });
    }
    const conv = conversations.get(title);
    if (userPrompt) conv.messages.push({ role: 'user', content: userPrompt });
    if (aiResponse) conv.messages.push({ role: 'assistant', content: aiResponse });
  }

  for (const conv of conversations.values()) {
    if (conv.messages.length === 0) continue;
    notes.push({ source: 'gemini', title: conv.title, date: conv.date, messages: conv.messages });
  }
  return notes;
}

function parseMarkdown(content, filename) {
  const base = path.basename(filename, path.extname(filename));
  return [{
    source: 'manual',
    title: base,
    date: new Date().toISOString(),
    messages: [{ role: 'document', content }],
  }];
}

function writeNote(note, targetDir) {
  const dateStr = dateSlug(note.date);
  const slug = slugify(note.title);
  const filename = `${dateStr} - ${slug}.md`;
  const fullPath = path.join(targetDir, filename);

  if (fs.existsSync(fullPath)) {
    return { skipped: true, path: fullPath, reason: 'already exists' };
  }

  const lines = [];
  lines.push('---');
  lines.push('type: imported-chat');
  lines.push(`source: ${note.source}`);
  lines.push(`original_date: ${dateStr}`);
  lines.push(`imported_at: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`messages: ${note.messages.length}`);
  lines.push('tags:');
  lines.push('  - imported');
  lines.push(`  - ${note.source}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${note.title}`);
  lines.push('');

  const roleEmoji = {
    user: '🧑 User',
    assistant: '🤖 Assistant',
    system: '⚙️ System',
    document: '📄 Document',
  };

  for (const msg of note.messages) {
    const label = roleEmoji[msg.role] || `**${msg.role}**`;
    lines.push(`## ${label}`);
    lines.push('');
    lines.push(msg.content);
    lines.push('');
  }

  if (!DRY_RUN) {
    ensureDir(targetDir);
    fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
  }
  return { skipped: false, path: fullPath };
}

function importFile(filePath) {
  const filename = path.basename(filePath);
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    return { error: `baca gagal: ${e.message}` };
  }

  const format = detectFormat(content, filename);

  let notes = [];
  try {
    if (format === 'chatgpt' || format === 'chatgpt-v2') notes = parseChatGPT(content);
    else if (format === 'gemini') notes = parseGemini(content);
    else if (format === 'markdown' || format === 'plaintext') notes = parseMarkdown(content, filename);
    else return { error: `format tidak dikenali (${format})` };
  } catch (e) {
    return { error: `parse gagal: ${e.message}` };
  }

  if (notes.length === 0) return { error: 'tidak ada conversation' };

  const results = { written: 0, skipped: 0, total: notes.length };
  for (const note of notes) {
    const targetDir = path.join(OUT_ROOT, note.source);
    const result = writeNote(note, targetDir);
    if (result.skipped) results.skipped++;
    else results.written++;
  }
  return { results, format };
}

// Export untuk dipakai modul lain
if (require.main === module) {
  ensureDir(INBOX); ensureDir(PROCESSED); ensureDir(OUT_ROOT);

  let files = SINGLE_FILE ? [SINGLE_FILE] : fs.readdirSync(INBOX)
    .filter((f) => !f.startsWith('.'))
    .map((f) => path.join(INBOX, f));

  if (files.length === 0) {
    console.log('📭 Tidak ada file di inbox.');
    console.log(`   Taruh file di: ${INBOX}`);
    process.exit(0);
  }

  console.log(`📥 Import mode${DRY_RUN ? ' [DRY RUN]' : ''}`);
  console.log(`   File: ${files.length}`);
  console.log('');

  let w = 0, s = 0, e = 0;
  for (const file of files) {
    const name = path.basename(file);
    console.log(`📄 ${name}`);
    const result = importFile(file);
    if (result.error) {
      console.log(`  ❌ ${result.error}`);
      e++; continue;
    }
    console.log(`  ✅ format=${result.format} written=${result.results.written} skipped=${result.results.skipped} total=${result.results.total}`);
    w += result.results.written; s += result.results.skipped;

    if (!DRY_RUN && !SINGLE_FILE) {
      try { fs.renameSync(file, path.join(PROCESSED, name)); }
      catch {}
    }
    console.log('');
  }
  console.log('─'.repeat(50));
  console.log(`📊 Total: ${w} ditulis, ${s} skipped, ${e} error`);
} else {
  module.exports = { importFile, detectFormat, INBOX, PROCESSED, OUT_ROOT };
}
