# Solitaire Play Lab

The n-Card Solitaire game (copied from solitaire-study), with think-aloud recording. You play and explain your choices by voice or typing. Claude, in a terminal beside the game, catalogs your reasons, asks a short question when a play isn't explained, and helps you put nuance into words. The aim is a play model that decides the way you do, starting with one more reliable than pure naive play.

## Set up on a Chromebook (once)

1. **Turn on Linux.** Settings → About ChromeOS → Developers → Linux development environment → Turn on. Then open the **Terminal** app and choose **penguin**.
2. **Install git, Node (for tests and the benchmark) and the GitHub CLI:**

   ```bash
   sudo apt update && sudo apt install -y git nodejs npm gh
   ```

3. **Get the repository** (`gh auth login` lets you push games back to GitHub later):

   ```bash
   gh auth login
   ```

   ```bash
   gh repo clone briankdew/solitaire-play-lab && cd solitaire-play-lab
   ```

4. **Install Claude Code**, then run `claude` once to sign in:

   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

Python 3 is already part of Chromebook Linux. The game and server need nothing else.

## Each session

1. **Start the game** in Terminal:

   ```bash
   ./play
   ```

   Open **http://localhost:8000** in Chrome. If that doesn't load, try **http://penguin.linux.test:8000**.

2. **Start Claude** in a second Terminal tab (Ctrl+Shift+T):

   ```bash
   cd ~/solitaire-play-lab && claude
   ```

   Then type `/play`. Claude follows the game from here.

3. **Play.** Before or after each play, say (**Speak**) or type why you chose it. The note goes with your next play.
   - **Claude's questions** appear in the gold box above the note. Answer there or in the terminal, whenever suits you; the game never waits.
   - **Microphone:** Chrome asks for permission the first time you press Speak. Speech recognition needs an internet connection. ChromeOS dictation (Search + D) and typing always work.

4. **After a game:** `/review` goes over it with you, fills the gaps and saves a summary. Claude commits and pushes the games and the catalog, so GitHub keeps everything.

## What gets recorded

`games/<setup>-<date>-<time>-<tag>.jsonl` holds one line per event:
- **Each move or turn of the stock:**
  - the position you saw (only cards you could see),
  - every play you had, with its factors and its score under your values,
  - the model's pick and whether you matched it,
  - your play (`A♠h`, and the record token `ASh--a`),
  - how long you took, and your note.
- **Other events:** the deal, undos, notes on their own, answers to questions, and the result.

The deal line also stores the shuffle, so a finished game can be replayed exactly. Claude doesn't look at it while you play.

## The model and the tools

| Command | What it does |
|---|---|
| `python3 tools/report.py` | How often your values pick the play you chose, by situation, plus the plays nothing explains |
| `python3 tools/report.py --game ID --plays` | One game, play by play |
| `python3 tools/fit.py` | Learns values from your choices into `model/learned.json`, next to yours for comparison |
| `node tools/benchmark.js 4223 --games 2000` | Win rates on the same shuffles: pure naive play, your values, the learned values, and the perfect-information best |
| `python3 tools/watch.py --follow` | The live game, one line per event (what `/play` reads) |

- **Your values** are in `model/valuation.json`: total = Σ value × factor. The factors are listed in `lab/features.js`. They start from your worked example, which scores the 4223 opening as A♠h 2.83 and the stock 0.33.
- **The reasons vocabulary** is `catalog/reasons.json`, and Claude's coding of each explained play is in `catalog/annotations.jsonl`. `catalog/terminology-draft.md` is your draft terms, copied as written.

## Tests

```bash
npm test
```

```bash
npm install && npx playwright install chromium && npm run test:e2e
```

The browser tests start `server.py` on port 4319 and record into `.lab-test-data/`.
