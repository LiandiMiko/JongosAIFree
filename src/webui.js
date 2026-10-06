const express = require('express');
const path = require('path');
const {
  runAgent,
  executeApprovedRequest,
  continueAgentAfterApproval,
} = require('./agent-loop');
const { addMessage } = require('./memory');
const { listPendingApprovals, denyRequest, getApproval } = require('./approval');
const { indexVault, loadIndex } = require('./rag');


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

  // Chat endpoint — returns structured result (answered vs approval_required)
  app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userId = `web-${sessionId || 'anonymous'}`;

    try {
      const result = await runAgent(message, config, {
        userId,
        source: 'webui',
      });

      if (result.status === 'answered') {
        return res.json({ status: 'answered', reply: result.answer });
      }

      if (result.status === 'approval_required') {
        return res.json({
          status: 'approval_required',
          requestId: result.requestId,
          tool: result.tool,
          args: result.args,
          policy: result.policy,
          message: result.message,
        });
      }

      res.json({ status: 'error', reply: result.message || 'Terjadi kesalahan.' });
    } catch (err) {
      console.error('[webui] Chat error:', err.message);
      res.status(500).json({ error: 'Something went wrong: ' + err.message });
    }
  });

  // Approvals endpoints
  app.get('/api/approvals', (req, res) => {
    try {
      // If sessionId provided, filter by it; otherwise return all pending (dashboard view)
      const userId = req.query.sessionId ? `web-${req.query.sessionId}` : null;
      const pending = listPendingApprovals(userId);
      res.json({ approvals: pending });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/approvals/approve', async (req, res) => {
    const { requestId, sessionId } = req.body;
    if (!requestId) {
      return res.status(400).json({ error: 'requestId required' });
    }

    // If sessionId omitted (dashboard call), look up the pending approval to get its userId
    const existing = getApproval(requestId);
    const userId = sessionId ? `web-${sessionId}` : (existing?.userId || 'web-anonymous');

    try {
      const execResult = await executeApprovedRequest(requestId, userId, { config });
      if (execResult.status === 'executed') {
        const finalRes = await continueAgentAfterApproval(execResult, config, {
          userId,
          source: 'webui',
        });

        // FIX C17: Handle chained approvals properly if continuation triggered another high-risk tool
        if (finalRes.status === 'approval_required') {
          return res.json({
            ok: true,
            status: 'approval_required',
            requestId: finalRes.requestId,
            tool: finalRes.tool,
            args: finalRes.args,
            policy: finalRes.policy,
            message: finalRes.message,
          });
        }

        return res.json({
          ok: true,
          status: 'approved',
          reply: finalRes.answer || 'Tool berhasil dieksekusi.',
        });
      }

      res.status(400).json({ error: execResult.message || 'Gagal mengeksekusi tool.' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/approvals/deny', (req, res) => {
    const { requestId, sessionId } = req.body;
    if (!requestId) {
      return res.status(400).json({ error: 'requestId required' });
    }

    const existing = getApproval(requestId);
    const userId = sessionId ? `web-${sessionId}` : (existing?.userId || 'web-anonymous');
    const result = denyRequest(requestId, userId);

    if (result.success) {
      res.json({ ok: true, message: 'Permintaan tool berhasil ditolak (denied).' });
    } else {
      res.status(400).json({ error: result.reason || 'Gagal menolak approval.' });
    }
  });


  // RAG endpoints
  app.get('/api/rag/stats', (req, res) => {
    try {
      const chunks = loadIndex();
      const uniqueNotes = new Set(chunks.map((c) => c.notePath)).size;
      res.json({
        totalChunks: chunks.length,
        totalNotesIndexed: uniqueNotes,
        indexed: chunks.length > 0,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/rag/reindex', (req, res) => {
    try {
      const result = indexVault();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Device data endpoint
  app.post('/api/device', async (req, res) => {
    const { sessionId, type, data } = req.body;

    if (!type || !data) {
      return res.status(400).json({ error: 'type and data required' });
    }

    const userId = `web-${sessionId || 'anonymous'}`;

    try {
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

  // Dashboard route
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
      const fs = require('fs');
      const VAULT = process.env.OBSIDIAN_VAULT || path.join(__dirname, '..', 'memory', 'second-brain');

      let mdCount = 0;
      let folderCount = 0;

      function walk(d) {
        let entries;
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
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

  app.listen(port, '0.0.0.0', () => {
    console.log(`[webui] Server running at http://localhost:${port} (or http://127.0.0.1:${port})`);
    console.log(`[webui] Dashboard: http://localhost:${port}/dashboard`);
  });
}

module.exports = { startWebUI };
