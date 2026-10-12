const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'memory.json');
const MAX_HISTORY = 20;
const AGENT_HISTORY_MESSAGES = 8;
const AGENT_HISTORY_MAX_CHARS = 800;

// FIX C7: Ensure data directory exists before Lowdb tries to create the file
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db = null;
// FIX C6: Store the init promise to prevent duplicate Lowdb instance race condition
let initPromise = null;

/**
 * Initialize the lowdb database (ESM dynamic import).
 * Uses a shared promise to prevent concurrent duplicate initialization.
 */
async function initDB() {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const { JSONFilePreset } = await import('lowdb/node');
      db = await JSONFilePreset(DB_PATH, { users: {} });
      return db;
    })();
  }
  return initPromise;
}

/**
 * Get conversation history for a user.
 * @param {string} userId
 * @returns {Array} Array of { role, content } messages
 */
async function getHistory(userId) {
  const database = await initDB();
  return database.data.users[userId]?.history || [];
}

/**
 * Add a message to a user's conversation history.
 * @param {string} userId
 * @param {string} role - 'user', 'assistant', or 'system'
 * @param {string} content
 */
async function addMessage(userId, role, content) {
  const database = await initDB();

  if (!database.data.users[userId]) {
    database.data.users[userId] = { history: [] };
  }

  database.data.users[userId].history.push({ role, content });

  // Trim to last MAX_HISTORY messages
  if (database.data.users[userId].history.length > MAX_HISTORY) {
    database.data.users[userId].history = database.data.users[userId].history.slice(-MAX_HISTORY);
  }

  await database.write();
}

/**
 * Clear conversation history for a user.
 * @param {string} userId
 */
async function clearHistory(userId) {
  const database = await initDB();

  if (database.data.users[userId]) {
    database.data.users[userId].history = [];
    await database.write();
  }
}

/**
 * Trim stored history into user/assistant turns the LLM can consume.
 * Drops system/remember notes so the agent JSON contract stays clean.
 */
function toLlmHistory(history, options = {}) {
  const maxMessages = options.maxMessages || AGENT_HISTORY_MESSAGES;
  const maxChars = options.maxChars || AGENT_HISTORY_MAX_CHARS;
  return (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-maxMessages)
    .map((m) => ({
      role: m.role,
      content: String(m.content || '').slice(0, maxChars),
    }));
}

module.exports = { getHistory, addMessage, clearHistory, toLlmHistory };
