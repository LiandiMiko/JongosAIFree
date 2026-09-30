# 🦞 JongosAIFree

**Personal AI Agent** dengan Telegram bot, WebUI dashboard, Obsidian Second Brain (RAG + CRUD), dan multi-provider AI routing.

Jalan di **Termux (Android)**, **Linux**, **macOS**, **Windows**.

---

## ✨ Fitur utama

- 💬 **Telegram bot** + WebUI chat
- 🧠 **Obsidian RAG + Vault Manager**:
  - **RAG Automatic Retriever**: Setiap pesan user otomatis mendapat konteks relevan dari vault Obsidian.
  - **Full Vault CRUD**: `read`, `search`, `create`, `append`, `update`, `move`, `delete`, `normalize`.
  - **Vault Organizer**: Mode `audit`, `plan`, dan `apply` untuk merapikan vault yang berantakan secara batch.
  - **Auto Re-index**: Setiap perubahan note otomatis memperbarui index RAG.
  - **Sensitive Note Protection**: Note dengan `sensitive: true` dilewati dari RAG dan perubahan otomatis.
- ⚡ **Multi-provider AI** — Groq, Gemini (multi-key rotation), OpenRouter, Mistral, SambaNova, LLM7, llama.cpp.
- 🔐 **Privacy layer** — Auto-redact API key dan kredensial sensitif sebelum dikirim ke LLM.
- 📊 **Dashboard** — Status provider, stats vault, list skill.
- 🛠️ **Built-in skills** — Shell execution, memory, device info, fetch, dll.
- 🚦 **Rate-limit aware routing** — Auto-skip provider yang rate-limited atau unhealthy.
- ✅ **Approval system** — Tool high-risk (`delete`, `move`, `organize`, `shell`) membutuhkan konfirmasi user.

---

## ⚡ Quick Start

### 1. Clone + Install

```bash
git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install
```

### 2. Setup

```bash
npm run setup
```

Wizard akan menuntun konfigurasi:
- Nama agent (default: Paijo)
- Port WebUI (default: 3000)
- API Keys (Groq, Gemini, OpenRouter, Mistral, dll.)
- Obsidian Vault path (`OBSIDIAN_VAULT`)
- Telegram Bot token (opsional)

### 3. Re-index Vault (Pertama kali)

```bash
node scripts/reindex-vault.js
```

### 4. Menjalankan Agent

```bash
npm start
```

Buka di browser:
- **Chat UI** → http://localhost:3000
- **Dashboard** → http://localhost:3000/dashboard

---

## 📂 Struktur Projek

```text
JongosAIFree/
├── src/
│   ├── vault/           # Shared Obsidian vault module (paths, frontmatter, note, links)
│   ├── providers/       # Modular LLM adapters (Groq, Gemini, OpenRouter, Mistral, dll.)
│   ├── agent/           # Agent loop, decision parser, tool executor
│   ├── rag/             # RAG chunker, embedder, vector store, retriever, indexer
│   ├── memory/          # Conversation history
│   ├── privacy/         # Secret scanner & redaction
│   └── gateway/         # Telegram & WebUI gateways
├── skills/              # Built-in skills (obsidian-*, shell, fetch, dll.)
├── data/
│   └── rag/             # Auto-generated vector index
├── scripts/
│   ├── setup.js
│   └── reindex-vault.js # Manual vault re-indexing script
├── index.js
├── package.json
└── README.md
```

---

## 🔑 Matriks Skill Vault

| Skill | Fungsi | Risk Level | Need Approval |
|---|---|---|---|
| `obsidian-read` | Baca isi note | Low | Tidak |
| `obsidian-search` | Pencarian keyword + RAG vector | Low | Tidak |
| `obsidian-tree` | Struktur folder vault | Low | Tidak |
| `obsidian-tags` | Daftar & filter tag | Low | Tidak |
| `obsidian-backlinks` | Backlink & outgoing links | Low | Tidak |
| `obsidian-context` | Bundel konteks topik | Low | Tidak |
| `obsidian-normalize` | Rapikan format frontmatter & H1 | Medium | Tidak |
| `obsidian-create` | Buat note baru | High | Ya |
| `obsidian-append` | Tambah isi di akhir note | High | Ya |
| `obsidian-update` | Timpa isi note | High | Ya |
| `obsidian-move` | Pindahkan / rename note | High | Ya |
| `obsidian-delete` | Hapus note | High | Ya |
| `obsidian-organize` | Audit, plan, & batch organize vault | High | Ya (mode apply) |

---

## 📄 Lisensi

MIT License - **JongosAIFree** by [LiandiMiko](https://github.com/LiandiMiko)
