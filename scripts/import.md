# Import AI Chats

Taruh file export di: `data/imports/inbox/`
Jalankan: `node scripts/import-ai-chats.js`

Format yang didukung:
- ChatGPT `conversations.json` (v1 & v2)
- Gemini Takeout (My Activity JSON)
- Markdown (.md) — disimpan as-is
- Plain text (.txt)

Flag:
- `--dry-run` — preview tanpa nulis
- `--file <path>` — import 1 file saja

File yang sukses akan dipindah ke `data/imports/processed/`.
