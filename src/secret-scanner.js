/**
 * Secret Scanner
 *
 * Mendeteksi dan meredact pola rahasia dalam teks sebelum dikirim ke LLM eksternal.
 *
 * Mode default: redact (aman, chat tetap jalan).
 * Detection log sengaja cuma tampilin preview 4 karakter pertama.
 */

const VERSION = '1.0.0';

// Pattern dengan value tunggal (langsung match = redact semua)
const VALUE_PATTERNS = [
  // OpenAI / Anthropic
  { name: 'openai-key', regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'anthropic-key', regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },

  // Google API key
  { name: 'google-api-key', regex: /\bAIza[A-Za-z0-9_-]{30,}\b/g },

  // Telegram bot token (1234567890:ABC...)
  { name: 'telegram-bot-token', regex: /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g },

  // GitHub
  { name: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: 'github-pat', regex: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/g },

  // AWS
  { name: 'aws-access-key', regex: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g },

  // Bearer token (di header atau text)
  { name: 'bearer-token', regex: /\bBearer\s+[A-Za-z0-9_.\-]{20,}/gi },

  // Private key block (PEM)
  {
    name: 'private-key-block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },

  // JWT
  { name: 'jwt', regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },

  // Slack token
  { name: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },

  // Stripe key
  { name: 'stripe-key', regex: /\b(sk|pk)_(live|test)_[A-Za-z0-9]{20,}\b/g },
];

// Pattern dengan nama key yang harus dipertahankan (key=value)
const KEYED_PATTERN = /\b(API[_-]?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIAL)\s*[:=]\s*["']?([A-Za-z0-9_\-.+/]{16,})["']?/gi;

function preview(str) {
  if (typeof str !== 'string' || str.length < 8) return '***';
  return str.slice(0, 4) + '…' + str.slice(-2);
}

/**
 * Scan dan redact satu string.
 * @param {string} text
 * @returns {{ text: string, detections: Array<{type: string, preview: string}> }}
 */
function scan(text) {
  if (typeof text !== 'string' || !text) {
    return { text, detections: [] };
  }

  const detections = [];
  let redacted = text;

  // 1. Value-only patterns
  for (const p of VALUE_PATTERNS) {
    redacted = redacted.replace(p.regex, (match) => {
      detections.push({ type: p.name, preview: preview(match) });
      return `[REDACTED:${p.name}]`;
    });
  }

  // 2. Keyed patterns (keep key name)
  redacted = redacted.replace(KEYED_PATTERN, (match, key, value) => {
    detections.push({ type: 'keyed-secret', key, preview: preview(value) });
    return `${key}=[REDACTED:keyed-secret]`;
  });

  return { text: redacted, detections };
}

/**
 * Scan array of messages (format OpenAI: [{role, content}, ...]).
 * Return salinan baru; original tidak diubah.
 * @param {Array} messages
 * @returns {{ messages: Array, detections: Array<{index, role, type, preview}> }}
 */
function scanMessages(messages) {
  if (!Array.isArray(messages)) {
    return { messages, detections: [] };
  }

  const allDetections = [];
  const out = messages.map((msg, index) => {
    if (!msg || typeof msg.content !== 'string') return msg;

    const { text, detections } = scan(msg.content);

    for (const d of detections) {
      allDetections.push({
        index,
        role: msg.role || 'unknown',
        type: d.type,
        key: d.key,
        preview: d.preview,
      });
    }

    return { ...msg, content: text };
  });

  return { messages: out, detections: allDetections };
}

/**
 * Ringkasan detections untuk logging.
 */
function formatDetections(detections) {
  if (!detections.length) return 'no secrets detected';
  const byType = {};
  for (const d of detections) {
    byType[d.type] = (byType[d.type] || 0) + 1;
  }
  return Object.entries(byType)
    .map(([type, count]) => `${type}×${count}`)
    .join(', ');
}

module.exports = {
  VERSION,
  scan,
  scanMessages,
  formatDetections,
};
