const { indexVault } = require('../src/rag');

console.log('🔄 Starting Obsidian Vault Re-indexing...');
const result = indexVault();

if (result.success) {
  console.log(`✅ Indexing Selesai! Berhasil mengindeks ${result.totalFiles} berkas menjadi ${result.totalChunks} chunks.`);
} else {
  console.error('❌ Gagal mengindeks vault. Pastikan path vault di .env atau config.json sudah benar.');
}
