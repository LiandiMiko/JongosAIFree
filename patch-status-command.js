const fs = require('fs');
const p = 'src/agent.js';
let s = fs.readFileSync(p, 'utf8');

// 1. Import getAllProviderStatus
const importAnchor = "const { runSkill, listSkills } = require('./skills');";
if (!s.includes(importAnchor)) throw new Error('Import anchor not found');
if (s.includes("require('./llm-status')")) throw new Error('llm-status already imported');
s = s.replace(importAnchor, importAnchor + "\nconst { getAllProviderStatus } = require('./llm-status');");

// 2. Add /status handler before /provider
const providerAnchor = "  if (trimmed === '/provider') {";
if (!s.includes(providerAnchor)) throw new Error('/provider anchor not found');
if (s.includes("trimmed === '/status'")) throw new Error('/status handler already exists');

const statusBlock = [
"  if (trimmed === '/status') {",
"    const all = getAllProviderStatus();",
"",
"    if (!all.length) {",
"      return '📊 Belum ada data usage. Coba kirim pesan dulu.';",
"    }",
"",
"    const fmt = (n) => Number(n || 0).toLocaleString('id-ID');",
"    const lines = ['📊 *LLM Usage Status*', ''];",
"",
"    for (const e of all) {",
"      const u = e.usage || {};",
"      lines.push('*' + e.provider + ' / ' + e.model + '*');",
"      lines.push('• Status        : `' + e.status + '`');",
"      lines.push('• Requests      : ' + fmt(u.requests));",
"      lines.push('• Input tokens  : ' + fmt(u.inputTokens));",
"      lines.push('• Output tokens : ' + fmt(u.outputTokens));",
"      lines.push('• Total tokens  : ' + fmt(u.totalTokens));",
"      if (e.limit !== null && e.limit !== undefined) {",
"        lines.push('• Quota limit   : ' + fmt(e.limit));",
"        lines.push('• Quota remain  : ' + fmt(e.remaining));",
"        lines.push('• Quota used    : ' + fmt(e.used));",
"      }",
"      if (e.retryAfter) lines.push('• Retry after   : ' + e.retryAfter + 's');",
"      if (e.resetAt)    lines.push('• Reset at      : ' + e.resetAt);",
"      if (e.lastError)  lines.push('• Last error    : ' + e.lastError);",
"      lines.push('');",
"    }",
"",
"    return lines.join('\\n');",
"  }",
"",
""
].join('\n');

s = s.replace(providerAnchor, statusBlock + providerAnchor);

// 3. Add /status to introText list
const introAnchor = "    '/skills',\n    '/device',";
if (s.includes(introAnchor)) {
  s = s.replace(introAnchor, "    '/skills',\n    '/status',\n    '/device',");
}

// 4. Add /status to /help list
const helpAnchor = "      '/skills   — Daftar skill',\n      '/device   — Akses perangkat',";
if (s.includes(helpAnchor)) {
  s = s.replace(helpAnchor, "      '/skills   — Daftar skill',\n      '/status   — Usage & quota LLM',\n      '/device   — Akses perangkat',");
}

fs.writeFileSync(p, s);
console.log('STATUS COMMAND OK');
