# 🦞 JongosAIFree

**Personal AI agent** dengan Telegram bot, WebUI dashboard, Obsidian memory, dan multi-provider AI routing.

Jalan di **Termux (Android)**, **Linux**, **macOS**, **Windows**.

## ✨ Fitur

- 💬 **Telegram bot** + WebUI chat
- 🧠 **Obsidian "second brain"** — baca, cari, bikin, edit note
- ⚡ **Multi-provider AI** — Groq, Gemini, OpenRouter, Mistral, SambaNova, LLM7, llama.cpp
- 🔐 **Privacy layer** — auto-redact API key sebelum ke LLM, sensitive note bypass
- 📊 **Dashboard** — status provider, vault stats, skills list
- 🛠️ **19 built-in skills** — memory, shell, device, fetch, dll
- 🚦 **Rate-limit aware routing** — auto-skip provider yang limit
- ✅ **Approval system** — tool high-risk butuh konfirmasi user

---

## ⚡ Quick Start

### 1. Clone + Install

**Termux (Android)** — install [Termux](https://f-droid.org/en/packages/com.termux/) dari F-Droid:

```bash
pkg update && pkg install -y nodejs git
git clone https://github.com/LiandiMiko/JongosAIFree.git ~/clawd-agent
cd ~/clawd-agent
npm install
```

**Linux / macOS**:

```bash
# Install Node.js 18+ dulu:
#   Ubuntu/Debian : sudo apt install nodejs npm
#   macOS         : brew install node
git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install
```

**Windows** — install [Node.js](https://nodejs.org) dulu, lalu di **PowerShell**:

```powershell
git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install
```

### 2. Setup

```bash
npm run setup
```

Wizard akan tanya:
- Nama agent (default: Paijo)
- Web port (default: 3000)
- API keys provider — isi yang kamu punya, sisanya Enter aja
- Local LLM URL (opsional)
- Obsidian vault path (opsional)
- Telegram bot token (opsional)

### 3. Jalanin

```bash
npm start
```

Buka:
- **Chat UI** → http://localhost:3000
- **Dashboard** → http://localhost:3000/dashboard

---

## 🔑 API Keys (semua GRATIS, no credit card)

| Provider | Gratis | Kecepatan | Daftar |
|---|---|---|---|
| **Groq** ⭐ | 14.4K req/hari | ~800ms | [console.groq.com](https://console.groq.com) |
| **Gemini** | 20 req/hari/key | 3-5s | [ai.google.dev](https://ai.google.dev) |
| **OpenRouter** | 50 req/hari | Bervariasi | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Mistral** | Terbatas | Cepat | [console.mistral.ai](https://console.mistral.ai) |
| **SambaNova** | Terbatas | ~3s | [cloud.sambanova.ai](https://cloud.sambanova.ai) |
| **LLM7.io** | 1M token/hari | ~2s | [llm7.io](https://llm7.io) |
| **llama.cpp** | Unlimited (lokal) | 2-3s (CPU) | Self-host |

**Minimal 1 provider** biar bisa jalan. **Groq** paling direkomendasikan — cepet + gratis + simpel.

---

## 📱 Setup Telegram Bot (opsional)

1. Buka chat dengan [@BotFather](https://t.me/BotFather)
2. Kirim `/newbot`
3. Kasih nama + username (misal `@PaijoBot`)
4. Copy token yang dikasih
5. Paste di wizard `npm run setup`

**Commands:**
- `/start` — intro
- `/status` — usage + quota per provider
- `/help` — bantuan
- `/reset` — hapus history

**Atau ngobrol natural:**
- *"Jo, buka file troubleshooting"*
- *"Jo, cari note tentang linux"*
- *"Jo, list folder di second brain"*
- *"Jo, harga btc hari ini?"* — auto-fetch dari internet

---

## 🧠 Setup Obsidian Vault (opsional)

JongosAIFree bisa baca/tulis note di vault Obsidian kamu.

1. Bikin vault pakai [Obsidian](https://obsidian.md) atau folder biasa
2. Isi path di setup waktu ditanya, atau edit `.env`:
   ```
   OBSIDIAN_VAULT=/path/to/your/vault
   ```
3. Test di Telegram/WebUI:
   - *"Jo, list folder di vault"*
   - *"Jo, cari note tentang project X"*

**Skill Obsidian:**

| Skill | Fungsi | Approval |
|---|---|---|
| `obsidian-read` | Baca note | Tidak |
| `obsidian-search` | Cari keyword | Tidak |
| `obsidian-tags` | List/filter tag | Tidak |
| `obsidian-backlinks` | Backlink + outgoing | Tidak |
| `obsidian-context` | Bundel konteks lengkap | Tidak |
| `obsidian-tree` | Struktur folder | Tidak |
| `obsidian-create` | Bikin note baru | Ya |
| `obsidian-append` | Tambah ke akhir note | Ya |
| `obsidian-update` | Replace isi note | Ya |

---

## 🛠️ Skill Lain

| Skill | Fungsi | Risk |
|---|---|---|
| `shell` | Command shell (safe list) | 🔴 HIGH |
| `readfile` | Baca file | 🟡 MEDIUM |
| `writefile` | Tulis file | 🔴 HIGH |
| `fetch` | HTTP GET request | 🟡 MEDIUM |
| `device-info` | Battery, GPS, camera (Termux only) | 🟡 MEDIUM |
| `ping` | Ping host | 🟢 LOW |
| `remember` | Simpan ke memory | 🟢 LOW |

Tool **HIGH risk** → butuh approval via Telegram (tombol Allow/Deny).

---

## 📊 Dashboard

Setelah `npm start`, buka http://localhost:3000/dashboard:

- **Providers** — status tiap provider (available/rate-limited/error)
- **Vault Stats** — jumlah .md, folder, skills
- **Skills** — semua skill + risk level
- **Top Tags** — tag paling umum di vault
- **Vault Tree** — struktur folder lengkap

Auto-refresh tiap 15 detik.

---

## 🚀 Tips

### Termux

```bash
termux-wake-lock     # Cegah Android kill proses
tmux new -s clawd    # Survive terminal close
# Ctrl+B, D untuk detach
tmux attach -t clawd # Reattach
```

Auto-start on reboot: install [Termux:Boot](https://f-droid.org/en/packages/com.termux.boot/).

### Desktop (systemd di Linux)

Bikin `/etc/systemd/system/clawd.service`:

```ini
[Unit]
Description=JongosAIFree
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/home/youruser/JongosAIFree
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable clawd
sudo systemctl start clawd
```

---

## 🐛 Troubleshooting

**"Missing API key for provider"**
→ Minimal 1 provider harus di-set. Cek `.env` atau jalanin `npm run setup` ulang.

**Bot Telegram nggak respon**
→ Cek koneksi ke `api.telegram.org`. Beberapa WiFi kantor ngeblok Telegram. Coba pakai data seluler.

**Obsidian skills disabled**
→ Cek path `OBSIDIAN_VAULT` di `.env` beneran ada.

**Port 3000 udah dipakai**
→ Edit `webPort` di `config.json`.

**Provider error "402"**
→ Provider butuh top-up. Skip di setup.

---

## 🏗️ Arsitektur

```
User (Telegram / WebUI)
       ↓
  agent-loop.js
       ↓
   callLLM()  →  Multi-provider router
       ↓          ├─ Groq
  skills/         ├─ Gemini
       ↓          ├─ OpenRouter
  Vault /         ├─ Mistral
  Device /        ├─ SambaNova
  Shell           ├─ LLM7
                  └─ llama.cpp (local)
```

**Fitur teknis:**
- Rate-limit aware routing (auto-skip provider yang limit)
- Per-key telemetry (Gemini key #1, #2, #3 tracked separately)
- Exponential backoff
- Model health cache (skip 503 selama 60 detik)
- JSON mode enforcement untuk agent loop
- Secret scanner (auto-redact API key sebelum ke LLM)
- Sensitive note bypass (note `sensitive: true` nggak pernah ke LLM)
- Approval system untuk tool high-risk

---

## 📄 License

MIT — bebas pakai, modif, distribusi.

---

## 🔗 Links

- **Repo**: [github.com/LiandiMiko/JongosAIFree](https://github.com/LiandiMiko/JongosAIFree)
- **Vault contoh**: [github.com/LiandiMiko/second-brain](https://github.com/LiandiMiko/second-brain)

---

🦞 **Selamat ngoding!**
