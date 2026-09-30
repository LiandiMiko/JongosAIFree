# 🦞 JongosAIFree

**Personal AI Agent** dengan Telegram bot, WebUI dashboard, Obsidian Second Brain (RAG + CRUD), dan multi-provider AI routing.

Jalan di **Termux (Android)**, **Linux**, **macOS**, **Windows**.

---

## ✨ Fitur utama

- 💬 **Telegram bot** + WebUI chat
- 🧠 **Obsidian RAG + Vault Manager**:
  - **RAG Automatic Retriever** — setiap pesan agent mendapat konteks relevan dari vault
  - **Full Vault CRUD** — `read`, `search`, `create`, `append`, `update`, `move`, `delete`, `normalize`
  - **Vault Organizer** — mode `audit`, `plan`, `apply` untuk merapikan vault batch
  - **Auto Re-index** — perubahan note otomatis update index RAG
  - **Sensitive Note Protection** — note `sensitive: true` dilewati dari RAG
- ⚡ **Multi-provider AI** — Groq, Gemini (multi-key), OpenRouter, Mistral, SambaNova, LLM7, llama.cpp
- 🔐 **Privacy layer** — auto-redact API key & kredensial sebelum ke LLM
- 📊 **Dashboard** — status provider, stats vault, list skill
- 🛠️ **Built-in skills** — shell, memory, device info, fetch, dll
- 🚦 **Rate-limit aware routing** — auto-skip provider yang limit / unhealthy
- ✅ **Approval system** — tool high-risk butuh konfirmasi user (Telegram inline button)

---

## ⚡ Quick Start

### 1. Clone + Install

```bash
git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install
```

**Termux (Android)** — install [Termux](https://f-droid.org/en/packages/com.termux/) dari F-Droid dulu:

```bash
pkg update && pkg install -y nodejs git
git clone https://github.com/LiandiMiko/JongosAIFree.git ~/jongos
cd ~/jongos
npm install
```

### 2. Setup

```bash
npm run setup
```

Wizard akan menuntun:
- Nama agent (default: **Paijo**)
- Port WebUI (default: 3000)
- API keys provider (isi yang kamu punya)
- Path Obsidian vault (opsional)
- Telegram bot token (opsional)

### 3. Re-index Vault (jika pakai Obsidian)

```bash
npm run reindex
```

### 4. Jalankan

```bash
npm start
```

- **Chat UI** → http://localhost:3000
- **Dashboard** → http://localhost:3000/dashboard

---

## 🔑 API Keys (gratis, tanpa kartu kredit)

| Provider | Gratis | Kecepatan | Daftar |
|---|---|---|---|
| **Groq** ⭐ | ~14K req/hari | ~800ms | [console.groq.com](https://console.groq.com) |
| **Gemini** | 20 req/hari/key | 3–5s | [ai.google.dev](https://ai.google.dev) |
| **OpenRouter** | 50 req/hari | bervariasi | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Mistral** | terbatas | cepat | [console.mistral.ai](https://console.mistral.ai) |
| **SambaNova** | terbatas | ~3s | [cloud.sambanova.ai](https://cloud.sambanova.ai) |
| **LLM7.io** | 1M token/hari | ~2s | [llm7.io](https://llm7.io) |
| **llama.cpp** | unlimited (lokal) | tergantung hardware | self-host |

Minimal **1 provider**. **Groq** paling direkomendasikan.

---

## 📂 Struktur proyek

```
JongosAIFree/
├── src/
│   ├── agent/           # Multi-step agent loop, decision parser, tool executor
│   ├── providers/       # LLM adapters (Groq, Gemini, OpenRouter, …)
│   ├── rag/             # Chunker, embedder, vector store, retriever, indexer
│   ├── vault/           # Obsidian paths, frontmatter, note, links
│   ├── agent-loop.js    # Facade untuk Telegram & WebUI
│   ├── telegram.js      # Telegram gateway
│   ├── webui.js         # Express WebUI + dashboard API
│   ├── approval.js      # High-risk tool approval
│   ├── tool-policy.js   # Risk levels per skill
│   ├── skills.js        # Skill loader
│   └── …
├── skills/              # Plugin skills (obsidian-*, shell, fetch, …)
├── scripts/
│   ├── reindex-vault.js
│   └── import-ai-chats.js
├── public/              # index.html + dashboard.html
├── setup.js
├── index.js
└── package.json
```

---

## 🔑 Matriks skill vault

| Skill | Fungsi | Risk | Approval |
|---|---|---|---|
| `obsidian-read` | Baca note | Low | Tidak |
| `obsidian-search` | Cari keyword + RAG | Low | Tidak |
| `obsidian-tree` | Struktur folder | Low | Tidak |
| `obsidian-tags` | List/filter tag | Low | Tidak |
| `obsidian-backlinks` | Backlink & outgoing | Low | Tidak |
| `obsidian-context` | Bundel konteks topik | Low | Tidak |
| `obsidian-normalize` | Rapikan frontmatter & H1 | Medium | Tidak |
| `obsidian-create` | Buat note baru | High | Ya |
| `obsidian-append` | Tambah isi note | High | Ya |
| `obsidian-update` | Timpa isi note | High | Ya |
| `obsidian-move` | Pindah / rename | High | Ya |
| `obsidian-delete` | Hapus note | High | Ya |
| `obsidian-organize` | Audit / plan / apply | High | Ya (mode apply) |

Skill lain: `shell` (High), `writefile` (High), `readfile` (Medium), `fetch` (Medium), `device-info` (Medium), `ping` / `remember` (Low).

---

## 📱 Telegram

1. Chat [@BotFather](https://t.me/BotFather) → `/newbot`
2. Paste token di `npm run setup`
3. Commands: `/start`, `/status`, `/help`, `/reset`

Obrolan natural juga jalan, misal: *"Jo, cari note tentang linux"*, *"Jo, list folder vault"*.

Tool high-risk akan memunculkan tombol **Allow / Deny**.

---

## 🐛 Troubleshooting

| Masalah | Solusi |
|---|---|
| No API keys found | Isi minimal 1 key di `.env` atau jalankan `npm run setup` |
| Bot Telegram tidak respon | Cek koneksi ke `api.telegram.org` (beberapa WiFi blokir Telegram) |
| Obsidian skills disabled | Set `OBSIDIAN_VAULT` di `.env` ke path yang valid |
| Port 3000 dipakai | Ubah `webPort` di `config.json` |
| Provider error 402/429 | Provider limit — sistem auto-fallback ke provider lain |

---

## 📄 Lisensi

MIT License — **JongosAIFree** by [LiandiMiko](https://github.com/LiandiMiko)

---

🦞 **Selamat ngoding!**
