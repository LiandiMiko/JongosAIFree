# 🦞 JongosAIFree (Termux Edition)

**Personal AI Agent** dengan Telegram bot, WebUI dashboard, Obsidian Second Brain, dan multi-provider AI routing.

> ⚠️ **Catatan Branch:** Kamu sedang membaca branch `termux-local`. Branch ini fokus pada **optimasi performa (Smart Warmup)**, **stabilitas multi-provider**, dan **Terminal UI (TUI)**. Fitur RAG dan modular refactor (`src/providers/`) ada di branch `master` utama.

Jalan di **Termux (Android)**, **Linux**, **macOS**, **Windows**.

---

## ✨ Fitur Utama

- 💬 **Telegram bot** + WebUI chat + Dashboard observability.
- 🖥️ **Terminal UI (TUI)**: Ngobrol dan monitor kuota langsung dari terminal.
- 🧠 **Obsidian Second Brain**: `read`, `search`, `create`, `append`, `update`, `tree`, `tags`, `backlinks`, `context`.
- ⚡ **Multi-provider AI**: Groq, Gemini (multi-key), OpenRouter, Mistral, SambaNova, LLM7, llama.cpp.
- 🚀 **Smart Warmup & Health State**: Model AI di-test otomatis saat startup. Yang mati/limit akan di-skip selama 10 menit (tersimpan permanen di disk).
- 🔐 **Privacy layer**: Auto-redact API key & kredensial sebelum dikirim ke LLM.
- 🚦 **Rate-limit aware routing**: Auto-fallback ke provider lain kalau provider utama limit.
- ✅ **Approval system**: Tool berisiko tinggi (hapus/tulis) butuh konfirmasi via Telegram atau Terminal.

---

## ⚡ Quick Start

### 1. Clone + Install

**Termux (Android)** — install [Termux](https://f-droid.org/en/packages/com.termux/) dari F-Droid dulu:

```bash
pkg update && pkg install -y nodejs git
git clone https://github.com/LiandiMiko/JongosAIFree.git ~/jongos
cd ~/jongos

# PENTING: Pindah ke branch termux-local
git checkout termux-local

npm install
```

2. Setup

```bash
npm run setup
```

Wizard akan menuntun:

· Nama agent (default: Paijo)
· Port WebUI (default: 3000)
· API keys provider (isi yang kamu punya, sisanya Enter)
· Path Obsidian vault (opsional)
· Telegram bot token (opsional)

3. Jalankan Bot (Telegram + WebUI)

```bash
npm start
```

· Chat UI → http://localhost:3000
· Dashboard → http://localhost:3000/dashboard

---

🖥️ Terminal UI (TUI)

JongosAIFree punya 2 mode TUI canggih yang jalan langsung di terminal. Buka terminal baru (biarkan bot npm start tetap jalan di terminal lama).

1. TUI Monitor (npm run tui)

Melihat status provider, request, token, dan error secara real-time.

```bash
npm run tui
```

Tampilan auto-refresh setiap 2 detik.

2. TUI Chat (npm run chat)

Ngobrol langsung dengan AI di terminal tanpa buka Telegram/Web.

```bash
npm run chat
```

TUI Commands:

· /help — Bantuan
· /status — Cek kuota provider
· /reset — Hapus history chat
· /quit — Keluar

Jika AI ingin menggunakan tool berisiko tinggi (misal: bikin note), TUI akan memunculkan prompt Allow? (y/N).

---

🔑 API Keys (Gratis, tanpa kartu kredit)

Provider Gratis Kecepatan Daftar
Groq ⭐ ~14K req/hari ~800ms console.groq.com
Gemini 20 req/hari/key 3–5s ai.google.dev
OpenRouter 50 req/hari bervariasi openrouter.ai/keys
LLM7.io 1M token/hari ~2s llm7.io
llama.cpp unlimited (lokal) tergantung hardware self-host

Minimal 1 provider. Groq paling direkomendasikan.

---

📂 Struktur Proyek (Branch Termux-Local)

```
JongosAIFree/
├── src/
│   ├── llm.js           # Multi-provider router + Smart Warmup + Health State
│   ├── agent-loop.js    # Agent loop & tool executor
│   ├── telegram.js      # Telegram gateway
│   ├── webui.js         # Express WebUI + dashboard API
│   ├── approval.js      # High-risk tool approval
│   ├── tool-policy.js   # Risk levels per skill
│   ├── skills.js        # Skill loader
│   ├── tui.js           # Terminal UI (Monitor)
│   └── tui-chat.js      # Terminal UI (Chat Interaktif)
├── skills/              # 19 plugin skills (obsidian-*, shell, fetch, …)
├── data/                # memory.json, llm-status.json, health-state.json
├── public/              # index.html + dashboard.html
├── setup.js
├── index.js
└── package.json
```

---

🛠️ Matriks Skill Vault

Skill Fungsi Risk Approval
obsidian-read Baca note Low Tidak
obsidian-search Cari keyword Low Tidak
obsidian-tree Struktur folder Low Tidak
obsidian-tags List/filter tag Low Tidak
obsidian-backlinks Backlink & outgoing Low Tidak
obsidian-context Bundel konteks topik Low Tidak
obsidian-create Buat note baru High Ya
obsidian-append Tambah isi note High Ya
obsidian-update Timpa isi note High Ya

Skill lain: shell (High), writefile (High), readfile (Medium), fetch (Medium), device-info (Medium), ping / remember (Low).

---

🐛 Troubleshooting

Masalah Solusi
No API keys found Isi minimal 1 key di .env atau jalankan npm run setup
Bot Telegram tidak respon Cek koneksi ke api.telegram.org (beberapa WiFi blokir Telegram)
Obsidian skills disabled Set OBSIDIAN_VAULT di .env ke path yang valid
Warmup terasa lama Hapus provider mati di .env (diberi tanda #), lalu restart
Port 3000 dipakai Ubah webPort di config.json

---

📄 Lisensi

MIT License — JongosAIFree by LiandiMiko
