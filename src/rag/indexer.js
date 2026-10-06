const path = require('path');
const { getVaultDir, vaultExists, walkMarkdownFiles, loadNote } = require('../vault');
const { chunkMarkdownNote } = require('./chunker');
const { saveIndex } = require('./store');

function indexVault() {
  if (!vaultExists()) {
    console.log(`[rag] Vault tidak ditemukan di path: ${getVaultDir()}`);
    return { success: false, totalChunks: 0, totalFiles: 0, skippedSensitive: 0 };
  }

  const files = walkMarkdownFiles();
  const allChunks = [];
  const vaultDir = getVaultDir();
  let skippedSensitive = 0;
  let skippedEmpty = 0;

  for (const absPath of files) {
    const relPath = path.relative(vaultDir, absPath).replace(/\\/g, '/');
    const note = loadNote(absPath);
    if (!note) {
      skippedEmpty += 1;
      continue;
    }
    if (note.sensitive) {
      skippedSensitive += 1;
      continue;
    }

    const chunks = chunkMarkdownNote(relPath, note.content);
    if (!chunks.length) {
      skippedEmpty += 1;
      continue;
    }
    allChunks.push(...chunks);
  }

  const totalIndexed = saveIndex(allChunks);
  console.log(
    `[rag] Reindex OK: ${files.length} files → ${totalIndexed} chunks` +
      ` (skip sensitive=${skippedSensitive}, empty=${skippedEmpty})`
  );
  return {
    success: true,
    totalChunks: totalIndexed,
    totalFiles: files.length,
    skippedSensitive,
    skippedEmpty,
  };
}

module.exports = {
  indexVault,
};
