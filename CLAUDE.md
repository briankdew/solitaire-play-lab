# Solitaire Play Lab: working agreement

## Purpose
The player plays Klondike-style solitaire here while explaining each decision, by voice or typing. Claude catalogs the reasons, asks a short question when a reason is unclear, and helps put into words any nuance that's hard to describe. The catalog becomes a play model that decides the way the player does. The first goal is a model **more reliable than pure naive play**: play any card that can be played, choosing at random when more than one can, and turn the stock only when no card can be played.

**Start from a clean slate.** The lab exists to define the player's terms and values from their own play. Bring in no factors, values or terms from earlier conversations or other repositories. Every reason code comes from the player's words and is adopted only with their agreement.

The player has played about 50,000 games by hand and leads the research. Follow their direction, keep comments to a minimum, and ask only to clarify. No personal details (such as an email address) in commits or files.

## How a session works
- The player runs `./play` (server.py, port 8000) and plays in Chrome. Every action is logged to `games/<game-id>.jsonl`.
- In Claude Code, `/play` follows the game live and `/review` goes over a finished game. The command files are in `.claude/commands/`.
- **Claude never coaches during play.** Don't suggest plays, evaluate a position aloud, or hint at hidden cards. Advice would change the data being collected.
- **Never read hidden information during play.** The `deck` field of a log's deal event holds the shuffle. Read logs only through `tools/watch.py`, which leaves it out. Replaying a game from its deck (`lab/log.js`) is for finished games only.

## Question rules
- **Ask when:**
  - the player had a real choice (2 or more plays) and gave no note,
  - a note uses a term that isn't in `catalog/reasons.json`,
  - two notes contradict each other.
- **Don't ask when:** only one play was possible, or the note already explains the play.
- **One question at a time, under 15 words,** about one action (`--n`). Plain words, the player's notation (`A♠h`, `4♥a`, `s`).
- If the player is moving fast, skip questions and catch up in `/review`.
- **New terms:** when the player describes something no code covers, suggest a short code, name and definition in one line (`tools/annotate.py --propose`). Adopt it only after the player agrees (`--adopt`). The player's own words go in the definition.

## Notation (from the player's game)
- **Piles:** `s` stock, `w` waste, `h` home (foundations), `a b c …` columns.
- **Cards:** rank then suit, X for ten (`XC`). Symbols on screen (`A♠`), letters in the official record (`AS`).
- **Play keys:** card + destination: `ASh`, `4Ha`, shown as `A♠h`, `4♥a`. `s` is a turn of the stock; with the stock empty, it turns the waste back over first.
- **Official record tokens** come from game.js: `ASh--a` is a move (card, destination, then the new top of the source and its letter); `4S2Hw` is a turn; `W9` / `L12` is the result.
- **Setup code:** high card, suits, columns, draw (`4223` = A–4 in ♠♥, 2 columns, draw 3; `K473` = a standard game).

## Files
| Path | What it is |
|---|---|
| `game.js`, `ui/`, `index.html`, `styles.css` | The game, copied from the player's solitaire-study app. Rules are unchanged; `ui/lab.js` and small hooks in `ui/actions.js` add the recording. |
| `lab/plays.js` | The plays available in a position and the visible position. Nothing judges or scores a play. |
| `lab/log.js` | Reading logs and replaying a game (Node). |
| `server.py`, `play` | The local server and its start script. |
| `games/*.jsonl` | One file per deal. Events: `deal` (settings, hidden `deck`, `view`, `plays`), `move` / `turn` (`n`, `key`, `token`, `think_ms`, `view` before the play, `plays`, `choices`, `note`, `revealed`, `turned`, `auto`), `undo` (`undoes`), `note`, `answer`, `end` (`result` W / L / quit / abandoned). |
| `live/question.json`, `live/answers.jsonl` | The question channel (not committed). |
| `catalog/reasons.json` | The reason vocabulary, empty at the start and built from the player's words. |
| `catalog/annotations.jsonl` | Claude's reading of each explained play. |
| `catalog/reviews/` | One summary per reviewed game. |
| `tools/` | `watch.py`, `ask.py`, `annotate.py` (live), `report.py` (what the games hold), `benchmark.js` (win rates of pure naive play and of perfect information). |

## Tests
- `npm test`: rule and lab tests (Node 18+).
- `npm run test:e2e`: browser tests, which start server.py on port 4319. If Playwright's browser isn't installed, set `PW_CHROMIUM` to a Chromium path.

## Changes
- Make visual changes one at a time, so each can be evaluated. Don't bundle changes nobody asked for.
- Keep game.js rules identical to the player's game unless the player asks for a change.
- Commit and push as work progresses. This repository is the master copy. Commit `games/` and `catalog/` along with the code.
