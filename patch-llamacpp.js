const fs = require('fs');
const p = 'src/llm.js';
let s = fs.readFileSync(p, 'utf8');

// 1. URL constant
const urlAnchor = "const OPENROUTER_URL =";
if (!s.includes(urlAnchor)) throw new Error('url anchor not found');
if (s.includes('LLAMACPP_URL')) throw new Error('already patched');
s = s.replace(urlAnchor, `const LLAMACPP_URL =
  process.env.LLAMACPP_URL ||
  'http://127.0.0.1:8080/v1';

const OPENROUTER_URL =`);

// 2. Provider config — taruh PALING ATAS biar jadi prioritas fallback
const provAnchor = "const PROVIDERS = {";
const provAddition = `const PROVIDERS = {
  llamacpp: {
    name: 'Local (llama.cpp)',
    models: [
      'gemma-3-4b-it',
    ],
  },
`;
if (!s.includes(provAnchor)) throw new Error('providers anchor not found');
s = s.replace(provAnchor, provAddition);

// 3. getApiKey
const keyAnchor = "    openrouter: process.env.OPENROUTER_API_KEY,";
s = s.replace(keyAnchor, `    llamacpp: process.env.LLAMACPP_API_KEY || 'local',
    openrouter: process.env.OPENROUTER_API_KEY,`);

// 4. callLlamaCpp function
const fnAnchor = "async function callOpenRouter(messages, model, options = {}) {";
const fnCode = `async function callLlamaCpp(messages, model, options = {}) {
  const apiKey = getApiKey('llamacpp');

  try {
    const response = await axios.post(
      \`\${LLAMACPP_URL}/chat/completions\`,
      {
        model,
        messages,
        max_tokens: 2048,
        temperature: 0.7,
        ...(options.json
          ? { response_format: { type: 'json_object' } }
          : {}),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey && apiKey !== 'local'
            ? { Authorization: \`Bearer \${apiKey}\` }
            : {}),
        },
        timeout: 120000,
      }
    );

    const text =
      response.data?.choices?.[0]?.message?.content?.trim();

    if (!text) {
      throw new Error('llama.cpp tidak mengembalikan response.');
    }

    const usage = response.data?.usage || {};

    recordUsage('llamacpp', model, {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });

    markSuccess('llamacpp', model, {
      lastError: null,
    });

    return text;
  } catch (error) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      throw new Error(\`llama.cpp tidak bisa dijangkau: \${error.message}\`);
    }
    throw error;
  }
}

${fnAnchor}`;
if (!s.includes(fnAnchor)) throw new Error('callOpenRouter anchor not found');
s = s.replace(fnAnchor, fnCode);

// 5. Routing di callLLM
const routeAnchor = `      if (provider === 'gemini') {
        return await callGemini(messages, model, options);
      }`;
const routeAddition = `      if (provider === 'llamacpp') {
        return await callLlamaCpp(messages, model, options);
      }

      if (provider === 'gemini') {
        return await callGemini(messages, model, options);
      }`;
if (!s.includes(routeAnchor)) throw new Error('routing anchor not found');
s = s.replace(routeAnchor, routeAddition);

fs.writeFileSync(p, s);
console.log('LLAMACPP PATCH OK');
