# Solitaire Play Lab

The n-Card Solitaire game (copied from solitaire-study), with think-aloud recording. You play and explain your choices by voice or typing. Claude, in a terminal beside the game, catalogs your reasons, asks a short question when a play isn't explained, and helps you put nuance into words. The aim is a play model that decides the way you do.

## Set up on a Chromebook (once)

1. **Turn on Linux.** Settings → About ChromeOS → Developers → Linux development environment → Turn on. Then open the **Terminal** app and choose **penguin**.
2. **Install git, Node (for the tests) and the GitHub CLI:**

   ```bash
   sudo apt update && sudo apt install -y git nodejs npm gh
   ```

3. **Get the repository** (`gh auth login` lets you push games back to GitHub later):

   ```bash
   gh auth login
   ```

   ```bash
   mkdir -p ~/linux_projects && cd ~/linux_projects && gh repo clone briankdew/solitaire-play-lab && cd solitaire-play-lab
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
   cd ~/linux_projects/solitaire-play-lab && claude
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
  - every play you had,
  - your play (`A♠h`, and the record token `ASh--a`),
  - how long you took, and your note.
- **Other events:** the deal, undos, notes on their own, answers to questions, and the result.

The deal line also stores the shuffle, so a finished game can be replayed exactly. Claude doesn't look at it while you play.

## The tools

The lab starts from a clean slate: no values, factors or reason codes are built in. The reasons vocabulary (`catalog/reasons.json`) starts empty and grows from your own words, and a code is adopted only when you agree. Claude's coding of each explained play goes in `catalog/annotations.jsonl`.

| Command | What it does |
|---|---|
| `python3 tools/report.py` | What the finished games hold: decisions, how many are explained, and the reasons used |
| `python3 tools/report.py --game ID --plays` | One game, play by play |
| `python3 tools/watch.py --follow` | The live game, one line per event (what `/play` reads) |

## Tests

```bash
npm test
```

```bash
npm install && npx playwright install chromium && npm run test:e2e
```

The browser tests start `server.py` on port 4319 and record into `.lab-test-data/`.
