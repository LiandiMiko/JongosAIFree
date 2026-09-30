const path = require('path');
const fs = require('fs');

// Pastikan .env ter-load meski skill dipanggil langsung
try {
  require('dotenv').config();
} catch {
  // ignore kalau dotenv belum terpasang
}

/**
 * Ambil path vault Obsidian.
 * Prioritas:
 * 1. ENV OBSIDIAN_VAULT
 * 2. Fallback: memory/second-brain di root project
 */
function getVaultDir() {
  const fromEnv = process.env.OBSIDIAN_VAULT;

  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim());
  }

  return path.resolve(__dirname, '..', '..', 'memory', 'second-brain');
}

/**
 * Cek apakah folder vault benar-benar ada.
 */
function vaultExists() {
  const dir = getVaultDir();
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

module.exports = {
  getVaultDir,
  vaultExists,
};