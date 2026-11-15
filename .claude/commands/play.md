---
description: Follow a game live, catalog the player's reasons, and ask short questions
---
The player is about to play (or is playing) in the browser with `./play` running. Follow along and build the catalog of their reasons.

1. Read `CLAUDE.md` (the question rules and the no-coaching, no-hidden-cards rules) and `catalog/reasons.json`. Glance at `model/valuation.json`.
2. Follow the game:
   - **Preferred:** start `python3 tools/watch.py --follow` with the Monitor tool, so each new line wakes you.
   - **Without Monitor:** run it in the background with Bash (`run_in_background`) and read its output whenever the player says something, or at least every few actions.
   - Each line is one event (DEAL, PLAY, TURN, UNDO, NOTE, ANSWER, END).
   - Never read `games/*.jsonl` directly while a game is in play: the deal line holds the hidden deck.
3. For each PLAY or TURN:
   - **With a note:** catalog it with `python3 tools/annotate.py --n N --codes ... --source note --quote "..." --summary "..."`.
   - **No note, but the question rules say to ask:** run `python3 tools/ask.py --n N --play "A♥h" "Short question?"`. The question appears in the game's panel. Ask only when no other question is open.
   - **No note and no question needed:** add nothing now. `/review` covers it.
4. **ANSWER** (or the player answers in the terminal): record a terminal answer with `python3 tools/ask.py --answer "..."`. Then annotate that action with `--source answer`.
5. **A reason no code covers:** suggest a code in one line ("New: `surface_soon`, Surface soon: … OK?"). On a yes, run `tools/annotate.py --propose ...` and then `--adopt`, and use it.
6. **Keep the terminal quiet:** at most one short line per event you act on. Never comment on the quality of a play, never suggest a play, never mention what a hidden card might be.
7. **On END:**
   - Give a 2–3 line tally: actions, notes, questions asked and answered, and how often the model's pick matched.
   - Ask whether to `/review` now or keep playing.
   - Keep following for the next deal.
