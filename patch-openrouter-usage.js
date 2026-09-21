const fs = require('fs');
const p = 'src/llm.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `    const headers = response.headers || {};`;

const replacement = `    const usage = response.data?.usage || {};

    recordUsage("openrouter", model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

${anchor}`;

if (!s.includes(anchor)) throw new Error('Anchor OpenRouter headers (4 spasi) tidak ditemukan');
if (s.includes('recordUsage("openrouter", model')) throw new Error('OpenRouter usage telemetry already exists');

s = s.replace(anchor, replacement);
fs.writeFileSync(p, s);
console.log('OPENROUTER USAGE TELEMETRY OK');
