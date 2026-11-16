# Solitaire Play Lab: working agreement

## Purpose
The player plays Klondike-style solitaire here while explaining each decision, by voice or typing. Claude catalogs the reasons, asks a short question when a reason is unclear, and helps put into words any nuance that's hard to describe. The catalog becomes a play model that decides the way the player does.

**Start from a clean slate.** The lab exists to define the player's terms and values from their own play. Bring in no factors, values, terms, baselines (such as naive play or perfect play) or results from earlier conversations or other repositories. Every reason code comes from the player's words and is adopted only with their agreement. The data set is only the games played here.

**Playing without memory: a goal, not a rule.** The player starts from the idea of not using memory or card counting (for example, playing a king to an empty column is automatic). It is an initial way of thinking, and it becomes nuanced. Sometimes the player "knows" a card is about to appear on the waste, because only a few cards are left in the stock and they just saw it. Sometimes they "hope" for a king of a particular colour, because they have a queen of the opposite colour to play on it. When a note leans on memory or hope like this, catalog it as such; don't treat it as breaking a rule.

**Method and exploratory games.** A game is a method game unless the player switches on **Exploratory game** in Think aloud (before dealing, or any time until the game ends; the setting when it ends is what counts). Exploratory games are for trying out a new strategy and talking it over. They are kept out of every analysis of how the player plays, the reason vocabulary's evidence and `/review` gap-filling, unless the player asks. During an exploratory game:
- don't ask the routine questions;
- discuss positions and strategy freely **when the player asks**;
- still never use hidden cards.
watch.py marks them `EXPLORATORY` (and `MARK` when the switch changes mid-game).

**Judgment marks.** The game marks some moves with chess-style judgments (`?` in the Game Record and at the start of a logged `token`). The player plans to develop this system; until they formalize it, don't use the marks in any analysis, question or summary.

The player has played about 50,000 games by hand and leads the research. Follow their direction, keep comments to a minimum, and ask only to clarify. No personal details (such as an email address) in commits or files.

## How a session works
- The player runs `./play` (server.py, port 8000) and plays in Chrome. Every action is logged to `games/<game-id>.jsonl`.
- In Claude Code, `/play` follows the game live and `/review` goes over a finished game. The command files are in `.claude/commands/`.
- **Claude never coaches during play.** Don't suggest plays, evaluate a position aloud, or hint at hidden cards. Advice would change the data being collected.
- **Never read hidden information during play.** The `deck` field of a log's deal event, and `games/index.jsonl`, hold shuffles. Read logs only through `tools/watch.py`, which leaves them out. Replaying a game from its deck (`lab/log.js`) is for finished games only.
- **Replays.** A shuffle can be dealt again from **Played shuffles**; watch.py marks the deal `REPLAY`. While a replay is in play, don't read or mention earlier games of that shuffle.

## Question rules
- **Ask when:**
  - the player had a real choice (2 or more plays) and gave no note,
  - a note uses a term that isn't in `catalog/reasons.json`,
  - two notes contradict each other.
- **Don't ask when:** only one play was possible, or the note already explains the play.
- **One question at a time, under 15 words,** about one action (`--n`). Plain words, the player's notation (`A♠h`, `4♥a`, `s`).
- If the player is moving fast, skip questions and catch up in `/review`.
- **New terms:** when the player describes something no code covers, suggest a short code, name and definition in one line (`tools/annotate.py --propose`). Adopt it only after the player agrees (`--adopt`). The player's own words go in the definition.
- **Refining codes:** when the player's words extend, sharpen or qualify an existing code, update that code instead of creating a new one (`tools/annotate.py --update CODE --definition "..."`; the old wording is kept in its `history`). Use the player's words and say so in one line. Propose a new code only when the reason is genuinely different.

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
| `shuffles.py`, `games/index.jsonl` | Shuffle IDs (`<setup>-<6-digit counter>-<12-hex fingerprint>`, e.g. `K473-000001-7f3a9c21d4e8`), mirror groups, each game's kind (method or exploratory), and the index of played shuffles (holds deck orders). `python3 shuffles.py --rebuild` rebuilds the index from the game logs. |
| `games/deleted/<shuffle id>/` | Shuffles deleted from Played shuffles: their game logs, coded reasons and reviews, kept so a delete can be undone (Restore in Played shuffles → Deleted, or `python3 shuffles.py --restore ID` with ./play stopped). Not committed. Counter numbers are never reused. |
| `games/*.jsonl` | One file per deal. Events: `deal` (settings, hidden `deck`, `shuffle`, `mirror`, `first_deal`, `exploratory`, `view`, `plays`), `mark` (`exploratory`, `after`), `move` / `turn` (`n`, `key`, `token`, `think_ms`, `view` before the play, `plays`, `choices`, `note`, `revealed`, `turned`, `auto`), `undo` (`undoes`), `note`, `answer`, `end` (`result` W / L / quit / abandoned, `exploratory`). |
| `live/question.json`, `live/answers.jsonl` | The question channel (not committed). |
| `catalog/reasons.json` | The reason vocabulary, empty at the start and built from the player's words. |
| `catalog/annotations.jsonl` | Claude's reading of each explained play. |
| `catalog/reviews/` | One summary per reviewed game. |
| `tools/` | `watch.py`, `ask.py`, `annotate.py` (live), `report.py` (what the games hold). |

## Tests
- `npm test`: rule and lab tests (Node 18+), then the shuffle-index tests (Python).
- `npm run test:e2e`: browser tests, which start server.py on port 4319. If Playwright's browser isn't installed, set `PW_CHROMIUM` to a Chromium path.

## Changes
- Make visual changes one at a time, so each can be evaluated. Don't bundle changes nobody asked for.
- Keep game.js rules identical to the player's game unless the player asks for a change.
- Commit and push as work progresses. This repository is the master copy. Commit `games/` and `catalog/` along with the code.
