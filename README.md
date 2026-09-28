cd ~/clawd-agent

cat > README.md <<'README_EOF'
# 🦞 JongosAIFree

**Personal AI agent** dengan:
- 💬 Telegram bot + WebUI chat
- 🧠 Obsidian "second brain" integration
- ⚡ Multi-provider AI routing (Groq, Gemini, OpenRouter, Mistral, SambaNova, LLM7, llama.cpp)
- 🔐 Privacy layer (auto-redact secret + sensitive note bypass)
- 📊 Dashboard observability (`/status`, WebUI dashboard)
- 🛠️ 19 built-in skills (memory, shell, device, fetch, dll)

Jalan di **Termux (Android)**, **Linux**, **macOS**, **Windows**.

---

## ⚡ Quick Start

### 1. Clone + Install

**Termux (Android)** — install [Termux](https://f-droid.org/en/packages/com.termux/) dari F-Droid:

```bash
pkg update && pkg install -y nodejs git
git clone https://github.com/LiandiMiko/JongosAIFree.git ~/clawd-agent
cd ~/clawd-agent
npm install

# Install Node.js 18+ dulu:
#   Ubuntu/Debian : sudo apt install nodejs npm
#   macOS         : brew install node
git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install

git clone https://github.com/LiandiMiko/JongosAIFree.git
cd JongosAIFree
npm install
