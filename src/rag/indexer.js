const fs = require('fs');
const path = require('path');
const { getVaultDir, vaultExists, walkMarkdownFiles, loadNote } = require('../vault');
const { chunkMarkdownNote } = require('./chunker');
const { saveIndex } = require('./store');

function indexVault() {
  if (!vaultExists()) {
    console.log(`[rag] Vault tidak ditemukan di path: ${getVaultDir()}`);
    return { success: false, totalChunks: 0, totalFiles: 0 };
  }

  const files = walkMarkdownFiles();
  const allChunks = [];
  const vaultDir = getVaultDir();

  for (const absPath of files) {
    const relPath = path.relative(vaultDir, absPath).replace(/\\/g, '/');
    const note = loadNote(absPath);
    if (!note || note.sensitive) continue;

    const chunks = chunkMarkdownNote(relPath, note.content);
    allChunks.push(...chunks);
  }

  const totalIndexed = saveIndex(allChunks);
  console.log(`[rag] Vault reindexed successfully. ${files.length} files -> ${totalIndexed} chunks.`);
  return { success: true, totalChunks: totalIndexed, totalFiles: files.length };
}

module.exports = {
  indexVault,
};
