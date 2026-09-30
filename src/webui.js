const express = require('express');
const path = require('path');
const { processMessage } = require('./agent');
const { addMessage } = require('./memory');

/**
 * Start the Web UI Express server
 * @param {Object} config - App configuration
 */
function startWebUI(config) {
  const app = express();
  const port = config.webPort || 3000;

  // Middleware
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Chat endpoint
  app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = `web-${sessionId || 'anonymous'}`;

    try {
      const reply = await processMessage(userId, message, config);
      res.json({ reply });
    } catch (err) {
      console.error('[webui] Chat error:', err.message);
      res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // Device data endpoint — receives browser device info and stores in memory
  app.post('/api/device', async (req, res) => {
    const { sessionId, type, data } = req.body;

    if (!type || !data) {
      return res.status(400).json({ error: 'type and data required' });
    }

    const userId = `web-${sessionId || 'anonymous'}`;

    try {
      // Store device data as system context in memory
      await addMessage(userId, 'system', `[Device ${type}] ${data}`);
      console.log(`[webui] Device data received: ${type} from ${userId}`);
      res.json({ ok: true });
    } catch (err) {
      console.error('[webui] Device data error:', err.message);
      res.status(500).json({ error: 'Failed to store device data' });
    }
  });

  // Info endpoint
  app.get('/api/info', (req, res) => {
    res.json({
      agentName: config.agentName || 'Clawd',
      model: config.model,
      version: '1.0.0',
    });
  });

  // Route eksplisit untuk /dashboard
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
  });

  // === Dashboard endpoints ===

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
      const input = query ? `obsidian-tree: ${query}` : 'obsidian-tree';
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

  app.listen(port, '0.0.0.0', () => {
    console.log(`[webui] Server running at http://localhost:${port} (or http://127.0.0.1:${port})`);
    console.log(`[webui] Dashboard: http://localhost:${port}/dashboard`);
  });
}

module.exports = { startWebUI };
