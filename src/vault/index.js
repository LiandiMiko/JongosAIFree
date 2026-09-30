const { getVaultDir, vaultExists } = require('./paths');
const { walkMarkdownFiles } = require('./walk');
const {
  parseFrontmatter,
  extractTags,
  isSensitive,
} = require('./frontmatter');
const { extractLinks } = require('./links');
const {
  loadNote,
  saveNote,
  resolveNotePath,
  makeSnippet,
} = require('./note');
const { buildNewNote, touchUpdated } = require('./format');

module.exports = {
  // paths
  getVaultDir,
  vaultExists,

  // walk
  walkMarkdownFiles,

  // frontmatter
  parseFrontmatter,
  extractTags,
  isSensitive,

  // links
  extractLinks,

  // note
  loadNote,
  saveNote,
  resolveNotePath,
  makeSnippet,

  // format
  buildNewNote,
  touchUpdated,
};