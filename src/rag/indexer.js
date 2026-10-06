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
  let skippedError = 0;

  for (const absPath of files) {
    // FIX D11: Wrap per-file processing in try-catch so one corrupt note
    // doesn't abort the entire reindex operation.
    try {
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

      // FIX C15: Iterative push instead of spread to avoid stack overflow
      // on large vaults (spread can exceed call stack with 65k+ elements)
      for (let i = 0; i < chunks.length; i++) {
        allChunks.push(chunks[i]);
      }
    } catch (err) {
      skippedError += 1;
      console.warn(`[rag] Skip file karena error: ${absPath} — ${err.message}`);
    }
  }

  const totalIndexed = saveIndex(allChunks);
  console.log(
    `[rag] Reindex OK: ${files.length} files → ${totalIndexed} chunks` +
      ` (skip sensitive=${skippedSensitive}, empty=${skippedEmpty}, error=${skippedError})`
  );
  return {
    success: true,
    totalChunks: totalIndexed,
    totalFiles: files.length,
    skippedSensitive,
    skippedEmpty,
    skippedError,
  };
}

module.exports = {
  indexVault,
};
