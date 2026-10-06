const { chunkMarkdownNote } = require('./chunker');
const {
  computeTermFrequency,
  cosineSimilarity,
  tokenize,
  tokenizeQuery,
} = require('./embedder');
const { saveIndex, loadIndex, searchIndex } = require('./store');
const { indexVault } = require('./indexer');
const { retrieveContext, diversifyByNote } = require('./retriever');

module.exports = {
  chunkMarkdownNote,
  computeTermFrequency,
  cosineSimilarity,
  tokenize,
  tokenizeQuery,
  saveIndex,
  loadIndex,
  searchIndex,
  indexVault,
  retrieveContext,
  diversifyByNote,
};
