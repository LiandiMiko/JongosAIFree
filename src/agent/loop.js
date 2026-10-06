const axios = require('axios');
const { callLLM } = require('../providers');
const {
  buildAgentSystemPrompt,
  parseAgentResponse,
  classifyIntent,
} = require('./decision');
const { validateAgentAction, executeAction } = require('./tool-executor');
const { retrieveContext, indexVault } = require('../rag');

const MUTATING_VAULT_TOOLS = [
  'obsidian-create',
  'obsidian-update',
  'obsidian-append',
  'obsidian-delete',
  'obsidian-move',
  'obsidian-normalize',
  'obsidian-organize',
];

/** Max chars of tool output fed back into the LLM (keeps context small). */
const MAX_TOOL_OUTPUT_CHARS = 4000;

/**
 * Multi-step agent loop.
 * Returns either a final answer string OR a structured approval object:
 *   { status: 'answered', answer: string }
 *   { status: 'approval_required', requestId, tool, args, policy, message, continuation }
 *   { status: 'error', message: string }
 */
async function runAgentLoop(userMessage, config = {}, meta = {}) {
  const maxSteps = config.maxSteps || 5;
  const agentName = config.agentName || 'Paijo';
  const userId = meta.userId || 'anonymous';

  const intent = classifyIntent(userMessage);
  const tickerList = Array.isArray(intent.tickers) ? intent.tickers : [];
  console.log(
    `[agent-loop] Intent: ${intent.type} (${intent.confidence}) skipRag=${intent.skipRag}` +
      (tickerList.length ? ` tickers=${tickerList.join(',')}` : '')
  );

  // Fast-path: pair ticker → fetch Binance langsung, LLM hanya format jawaban
  let prefetchedPrices = null;
  let toolsUsedSeed = [];
  if (intent.type === 'realtime' && tickerList.length > 0 && !meta.toolResult) {
    prefetchedPrices = await fetchBinanceTickers(tickerList);
    console.log(
      `[agent-loop] Prefetch Binance: ${prefetchedPrices.ok ? 'OK' : 'FAIL'} ` +
        `${JSON.stringify(prefetchedPrices.rows || prefetchedPrices.error)}`
    );
  }

  let ragContext = '';
  let ragUsed = false;

  if (intent.skipRag) {
    console.log(`[rag] Skip RAG — intent=${intent.type}`);
  } else {
    try {
      ragContext = retrieveContext(userMessage, 4);
      if (ragContext && !ragContext.includes('Index kosong')) {
        ragUsed = true;
      }
    } catch (err) {
      console.log('[rag] Skipped context retrieval:', err.message);
    }
  }

  // Fast-path: pure time questions — no LLM tool loop needed for clock
  // (still use LLM for natural phrasing would be nicer, but server time in prompt is enough;
  // we let LLM answer with final using server time in system prompt)

  let systemPrompt = buildAgentSystemPrompt(agentName, ragUsed, {
    intent,
    realtimeMode: intent.type === 'realtime',
  });
  if (ragContext && !intent.skipRag) {
    systemPrompt += `\n\n${ragContext}`;
    if (intent.type === 'vault' && ragUsed) {
      systemPrompt +=
        '\n\n[SISTEM] RAG sudah menyertakan cuplikan vault. ' +
        'Jika cuplikan relevan, jawab FINAL langsung tanpa obsidian-search. ' +
        'Panggil obsidian-search paling banyak 1 kali, hanya jika RAG jelas tidak cukup.';
    }
  }
  if (intent.progressLog) {
    const pl = intent.progressLog;
    systemPrompt +=
      `\n\n[SISTEM PROGRESS LOG]\n` +
      `Target note: ${pl.note}\n` +
      `Isi entry: - [TANGGAL_HARI_INI] ${pl.entry}\n` +
      `Langkah: (1) obsidian-append dengan note+content. ` +
      `(2) Jika "Note tidak ditemukan" → obsidian-create dengan note+content yang sama, lalu final. ` +
      `JANGAN obsidian-search. JANGAN tool lain.`;
  }
  if (prefetchedPrices && prefetchedPrices.ok) {
    systemPrompt +=
      `\n\n## DATA HARGA LIVE (SUDAH DI-FETCH SISTEM — JANGAN FETCH LAGI)\n` +
      prefetchedPrices.formatted +
      `\n\nWAJIB action "final" memakai data di atas. ` +
      `JANGAN panggil tool fetch. JANGAN ganti ke PAXG/XAUT/token lain.`;
  }

  const priorHistory = Array.isArray(meta.history) ? meta.history : [];
  const messages = [
    { role: 'system', content: systemPrompt },
    ...priorHistory,
    { role: 'user', content: userMessage },
  ];

  if (prefetchedPrices && prefetchedPrices.ok) {
    messages.push({
      role: 'user',
      content:
        `[SISTEM] Harga Binance sudah diambil otomatis untuk: ${tickerList.join(', ')}.\n` +
        prefetchedPrices.formatted +
        `\n\nJawab FINAL sekarang (simbol, harga, sumber URL, waktu server). Jangan fetch lagi.`,
    });
    toolsUsedSeed = ['fetch'];
    intent.blockTools = [...new Set([...(intent.blockTools || []), 'fetch', 'shell'])];
  }

  if (meta.toolResult) {
    messages.push({
      role: 'user',
      content: `Hasil eksekusi tool ${meta.toolResult.tool}:\n${truncateOutput(meta.toolResult.output)}`,
    });
  }

  let toolsUsed = Array.isArray(meta.toolsUsed) && meta.toolsUsed.length
    ? [...meta.toolsUsed]
    : [...toolsUsedSeed];
  const toolCallCounts = new Map(); // sig -> count (anti-repeat)
  let step = Number.isInteger(meta.step) ? meta.step : 0;

  while (step < maxSteps) {
    step++;
    console.log(`[agent-loop] Step ${step}/${maxSteps}`);

    let rawResponse;
    try {
      rawResponse = await callLLM(messages, config, {
        json: true,
        tier: intent.tier,
        intent,
      });
    } catch (err) {
      console.error(`[agent-loop] LLM Call error at step ${step}:`, err.message);
      return {
        status: 'error',
        message: `Maaf, terjadi masalah pada koneksi AI: ${err.message}`,
      };
    }

    const parsed = parseAgentResponse(rawResponse);
    const validation = validateAgentAction(parsed);

    if (!validation.valid) {
      console.log(`[agent-loop] Invalid response: ${validation.reason}`);
      messages.push({ role: 'assistant', content: rawResponse });
      messages.push({
        role: 'user',
        content: `Sistem Error: Response tidak valid. ${validation.reason}. Tolong perbaiki format JSON kamu.`,
      });
      continue;
    }

    if (parsed.action === 'final') {
      console.log(`[agent-loop] Final answer reached at step ${step}`);
      const footer = buildSourceFooter({
        ragUsed,
        toolsUsed,
        intent,
      });
      return {
        status: 'answered',
        answer: `${parsed.reply}\n\n${footer}`,
        intent,
        toolsUsed,
      };
    }

    if (parsed.action === 'tool') {
      // Soft policy: reject tools blocked by intent before execution
      if (
        Array.isArray(intent.blockTools) &&
        intent.blockTools.includes(parsed.tool)
      ) {
        console.log(
          `[agent-loop] Blocked tool "${parsed.tool}" by intent policy (${intent.type})`
        );
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content:
            `Eksekusi Tool Ditolak: Tool "${parsed.tool}" tidak diizinkan untuk intent "${intent.type}". ` +
            (intent.preferTools?.length
              ? `Gunakan salah satu: ${intent.preferTools.join(', ')}.`
              : 'Jawab final langsung jika memungkinkan.'),
        });
        continue;
      }

      // Cap noisy tools per request (search spam burns LLM quota)
      const TOOL_MAX = { 'obsidian-search': 1, fetch: 3 };
      const maxForTool = TOOL_MAX[parsed.tool];
      if (maxForTool != null) {
        const used = toolsUsed.filter((t) => t === parsed.tool).length;
        if (used >= maxForTool) {
          console.log(`[agent-loop] Cap tool "${parsed.tool}" (${used}/${maxForTool})`);
          messages.push({ role: 'assistant', content: rawResponse });
          messages.push({
            role: 'user',
            content:
              `Eksekusi Tool Ditolak: "${parsed.tool}" sudah dipanggil ${used}x di request ini (batas ${maxForTool}). ` +
              `Jawab FINAL sekarang berdasarkan hasil tool sebelumnya / RAG. Jangan panggil tool yang sama lagi.`,
          });
          continue;
        }
      }

      // Prevent identical tool+args spam (e.g. fetch same URL 3x)
      const callSig = `${parsed.tool}::${JSON.stringify(parsed.args || {})}`;
      const prevCount = toolCallCounts.get(callSig) || 0;
      if (prevCount >= 1) {
        console.log(`[agent-loop] Repeat tool blocked: ${callSig}`);
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content:
            `Eksekusi Tool Ditolak: Tool "${parsed.tool}" dengan args yang sama sudah dijalankan. ` +
            `JANGAN fetch/tool ulang. Gunakan hasil sebelumnya dan segera action "final".`,
        });
        continue;
      }
      toolCallCounts.set(callSig, prevCount + 1);

      console.log(`[agent-loop] Executing tool: ${parsed.tool}`);
      toolsUsed.push(parsed.tool);

      const result = await executeAction(parsed, {
        ...meta,
        userId,
        userText: userMessage,
        history: messages.slice(1),
        step,
        config,
        source: meta.source || 'agent',
        intent,
      });

      if (result.status === 'approval_required') {
        return {
          status: 'approval_required',
          requestId: result.requestId,
          tool: result.tool,
          args: result.args,
          policy: result.policy,
          message: result.message,
          continuation: {
            userText: userMessage,
            history: messages.slice(1),
            step,
            toolsUsed,
            ragUsed,
            intent,
          },
        };
      }

      if (result.status === 'blocked') {
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `Eksekusi Tool Ditolak: ${result.error}`,
        });
        continue;
      }

      if (result.status === 'error') {
        messages.push({ role: 'assistant', content: rawResponse });
        messages.push({
          role: 'user',
          content: `Error tool ${parsed.tool}: ${result.error}`,
        });
        continue;
      }

      if (MUTATING_VAULT_TOOLS.includes(parsed.tool)) {
        try {
          indexVault();
        } catch (rErr) {
          console.log('[rag] Auto reindex after mutation error:', rErr.message);
        }
      }

      const outputText = truncateOutput(result.output || '(No output)');
      messages.push({ role: 'assistant', content: rawResponse });
      let resultMsg = `Hasil eksekusi tool ${parsed.tool}:\n${outputText}`;
      if (parsed.tool === 'fetch') {
        const failed = /^Gagal fetch:/i.test(String(result.output || ''));
        if (!failed) {
          resultMsg +=
            '\n\n[SISTEM] Fetch berhasil. WAJIB segera action "final" dengan harga/data di atas. ' +
            'Jangan fetch lagi kecuali user minta sumber lain.';
        }
      }
      messages.push({
        role: 'user',
        content: resultMsg,
      });
    }
  }

  return {
    status: 'error',
    message:
      'Maaf, batas maksimum langkah (max steps) tercapai sebelum mendapat jawaban akhir.',
  };
}

function truncateOutput(text) {
  const s = String(text ?? '');
  if (s.length <= MAX_TOOL_OUTPUT_CHARS) return s;
  return (
    s.slice(0, MAX_TOOL_OUTPUT_CHARS) +
    `\n… [output dipotong ${s.length - MAX_TOOL_OUTPUT_CHARS} karakter]`
  );
}

/**
 * Consistent source footer based on tools actually used + RAG.
 */
function buildSourceFooter({ ragUsed, toolsUsed, intent }) {
  const unique = [...new Set(toolsUsed || [])];
  const vaultTools = unique.filter((t) => t.startsWith('obsidian-'));
  const usedFetch = unique.includes('fetch');
  const usedShell = unique.includes('shell');
  const otherTools = unique.filter(
    (t) => !t.startsWith('obsidian-') && t !== 'fetch' && t !== 'shell'
  );

  const parts = [];

  if (vaultTools.length > 0) {
    parts.push(`📂 **Vault** _(tools: ${vaultTools.join(', ')})_`);
  } else if (ragUsed) {
    parts.push(`📂 **Vault (RAG)**`);
  }

  if (usedFetch) {
    parts.push(`🌐 **Fetch**`);
  }
  if (usedShell) {
    parts.push(`💻 **Shell**`);
  }
  if (otherTools.length > 0) {
    parts.push(`🔧 **Tool:** ${otherTools.join(', ')}`);
  }

  if (parts.length === 0) {
    if (intent && (intent.type === 'time' || intent.type === 'status')) {
      parts.push(
        intent.type === 'time'
          ? `🕐 **Waktu server**`
          : `📊 **Status provider**`
      );
    } else {
      parts.push(`🧠 **AI** _— tanpa vault/fetch_`);
    }
  }

  return `---\n${parts.join(' · ')}`;
}


/**
 * Prefetch spot prices from Binance for detected tickers.
 * Catatan: XAUUSDT tidak ada di Binance Spot — fallback ke XAUTUSDT + PAXGUSDT (token emas).
 */
async function fetchBinanceTickers(symbols) {
  const bases = [
    'https://api.binance.com',
    'https://data-api.binance.vision',
  ];

  async function fetchOne(symbol) {
    let lastErr = null;
    for (const base of bases) {
      const url = `${base}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
      try {
        const res = await axios.get(url, {
          timeout: 12000,
          headers: { 'User-Agent': 'JongosAIFree/1.0', Accept: 'application/json' },
        });
        const data = res.data || {};
        if (data.code && data.msg) {
          lastErr = data.msg;
          continue;
        }
        if (data.symbol && data.price != null) {
          return { ok: true, symbol: data.symbol, price: data.price, url };
        }
        lastErr = 'response tidak dikenal';
      } catch (e) {
        lastErr = e.response?.data?.msg || e.message;
      }
    }
    return { ok: false, symbol, error: lastErr || 'gagal' };
  }

  const expanded = [];
  const notes = [];
  for (const symbol of symbols) {
    expanded.push(symbol);
    // XAUUSDT / XAUSDT tidak listing di Binance Spot
    if (/^XAU(USDT|USD|USDC)?$/i.test(symbol) || symbol === 'XAUSDT') {
      notes.push(
        `${symbol} tidak tersedia sebagai pair spot Binance. ` +
          `Dipakai proksi emas: XAUTUSDT (Tether Gold) dan PAXGUSDT (PAX Gold).`
      );
      for (const alt of ['XAUTUSDT', 'PAXGUSDT']) {
        if (!expanded.includes(alt)) expanded.push(alt);
      }
    }
  }

  const rows = [];
  const errors = [];
  for (const symbol of expanded) {
    const r = await fetchOne(symbol);
    if (r.ok) {
      rows.push({ symbol: r.symbol, price: r.price, url: r.url });
    } else {
      errors.push(`${symbol}: ${r.error}`);
    }
  }

  if (!rows.length) {
    return { ok: false, error: errors.join('; ') || 'tidak ada data', notes };
  }

  const formatted = [
    ...(notes.length ? notes.map((n) => `NOTE: ${n}`) : []),
    ...rows.map((r) => `- ${r.symbol}: ${r.price} (sumber: ${r.url})`),
  ].join('\n');

  return { ok: true, rows, formatted, errors, notes };
}

module.exports = {
  runAgentLoop,
  buildSourceFooter,
  truncateOutput,
  classifyIntent,
  fetchBinanceTickers,
};
