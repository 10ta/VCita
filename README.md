# 🔥 VocabForge

Minimalist Anki alternative with **Ebbinghaus spaced repetition** and **auto-translation**.

No account needed. No sync servers. Just a local app + GitHub backup.

## Features

- **Input → Auto Translate** — type a word, hit Enter, Claude translates it (with phonetic, POS, example sentence)
- **Ebbinghaus Scheduling** — reviews at Day 1, 2, 4, 7, 15, 30, 60, 120, 240
- **Deck Management** — create multiple decks like Anki
- **JSON Export/Import** — one-click export, push to GitHub for backup
- **10 Languages** — Chinese, Japanese, Korean, Spanish, French, German, Portuguese, Russian, Arabic, English

## Quick Start

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/vocab-forge.git
cd vocab-forge

# 2. Install
npm install

# 3. Run
npm run dev
```

Open http://localhost:3000 — first launch will ask for your **Anthropic API key**.

### Get an API Key

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
2. Create a new key
3. Paste it into the app settings

The key is stored in your browser's `localStorage` only. Never sent anywhere except the Anthropic API.

## Build for Production

```bash
npm run build
```

Output in `dist/` — open `dist/index.html` or serve with any static server.

## Backup Workflow

```bash
# In the app: click Export → downloads vocabforge-YYYY-MM-DD.json

# Move to your repo
mv ~/Downloads/vocabforge-*.json ./data.json

# Commit & push
git add data.json
git commit -m "vocab backup $(date +%F)"
git push
```

To restore: open the app → Import JSON → select your `data.json`.

## Project Structure

```
vocab-forge/
├── index.html          # Entry point
├── package.json        # Dependencies (React + Vite)
├── vite.config.js      # Vite config
├── src/
│   ├── main.jsx        # React mount
│   └── App.jsx         # All app logic (single file)
├── data.json           # Your vocab backup (after export)
└── .gitignore
```

## Cost

Translation uses Claude Sonnet. Each word costs roughly **$0.001** (one tenth of a cent). 1000 words ≈ $1.

## License

MIT — do whatever you want with it.
