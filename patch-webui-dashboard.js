const fs = require('fs');
const p = 'src/webui.js';
let s = fs.readFileSync(p, 'utf8');

// Tambah endpoint sebelum app.listen
const anchor = `  app.listen(port, '0.0.0.0', () => {`;

const endpoints = `  // === Dashboard endpoints ===

  app.get('/api/status', (req, res) => {
    try {
      const { getAllProviderStatus } = require('./llm-status');
      res.json({ providers: getAllProviderStatus() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/skills', (req, res) => {
    try {
      const { loadSkills, getSkillManifest } = require('./skills');
      loadSkills();
      const manifest = getSkillManifest();
      const { getToolPolicy } = require('./tool-policy');
      const enriched = manifest.map((s) => {
        const policy = getToolPolicy(s.name);
        return {
          name: s.name,
          description: s.description,
          risk: policy.risk,
          label: policy.label,
        };
      });
      res.json({ skills: enriched, total: enriched.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tree', async (req, res) => {
    try {
      const query = req.query.path || '';
      const skill = require('../skills/obsidian-tree');
      const input = query ? \`obsidian-tree: \${query}\` : 'obsidian-tree';
      const result = await skill.run(input);
      res.json({ tree: result, path: query || 'root' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/stats', async (req, res) => {
    try {
      const skill = require('../skills/obsidian-tags');
      const tagsResult = await skill.run('obsidian-tags');

      // Hitung manual
      const fs = require('fs');
      const path = require('path');
      const VAULT = process.env.OBSIDIAN_VAULT ||
        path.join(__dirname, '..', 'memory', 'second-brain');

      let mdCount = 0;
      let folderCount = 0;

      function walk(d) {
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
          if (e.name.startsWith('.') || e.name === 'node_modules') continue;
          if (e.isDirectory()) {
            folderCount++;
            walk(path.join(d, e.name));
          } else if (e.name.endsWith('.md')) {
            mdCount++;
          }
        }
      }
      walk(VAULT);

      res.json({
        mdCount,
        folderCount,
        tags: tagsResult,
        vault: VAULT,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // === End dashboard endpoints ===

${anchor}`;

if (!s.includes(anchor)) throw new Error('listen anchor not found');
if (s.includes("'/api/status'")) throw new Error('already patched');
s = s.replace(anchor, endpoints);

fs.writeFileSync(p, s);
console.log('WEBUI DASHBOARD ENDPOINTS OK');
