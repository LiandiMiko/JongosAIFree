# Memory / Second Brain

Folder ini adalah fallback vault jika `OBSIDIAN_VAULT` tidak di-set di `.env`.

Cara pakai:
1. Set path vault di `.env`:
   ```
   OBSIDIAN_VAULT=/path/ke/vault-obsidian-kamu
   ```
2. Atau buat symlink manual:
   ```bash
   # Linux/macOS
   ln -s /path/ke/vault ./memory/second-brain

   # Termux
   ln -s /storage/emulated/0/Documents/second-brain ./memory/second-brain
   ```
3. Jalankan reindex:
   ```bash
   npm run reindex
   ```

Jangan commit isi vault pribadi ke git.
