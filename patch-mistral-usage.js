const fs = require('fs');
const p = 'src/llm.js';
let s = fs.readFileSync(p, 'utf8');

const anchor = `    markSuccess("mistral", model, {`;

const replacement = `    const usage = response.data?.usage || {};

    recordUsage("mistral", model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

${anchor}`;

if (!s.includes(anchor)) throw new Error('Anchor Mistral markSuccess tidak ditemukan');
if (s.includes('recordUsage("mistral", model')) throw new Error('Mistral usage telemetry already exists');

s = s.replace(anchor, replacement);
fs.writeFileSync(p, s);
console.log('MISTRAL USAGE TELEMETRY OK');
