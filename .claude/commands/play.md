---
description: Follow a game live, catalog the player's reasons, and ask short questions
---
The player is about to play (or is playing) in the browser with `./play` running. Follow along and build the catalog of their reasons.

1. Read `CLAUDE.md` (the clean-slate, question, no-coaching and no-hidden-cards rules) and `catalog/reasons.json`.
2. Follow the game:
   - **Preferred:** start `python3 tools/watch.py --follow` with the Monitor tool, so each new line wakes you. Start it as soon as the player wants to play, before they deal (it can't tell you about a deal it isn't running for).
   - **Re-arming:** a Monitor expires after 30 minutes. Re-arm without repeating lines already seen: `K=$(python3 tools/watch.py | wc -l) && python3 -u tools/watch.py --follow | awk -v k="$K" 'NR>k {print; fflush()}'`, then check `python3 tools/watch.py | tail -1` for anything that landed in between. After changing `tools/labfiles.py` or `tools/watch.py`, restart the Monitor so it runs the new code. With no game in progress for a long while, let it lapse and restart it when the player is back.
   - **Without Monitor:** run it in the background with Bash (`run_in_background`) and read its output whenever the player says something, or at least every few actions.
   - Each line is one event (DEAL, PLAY, TURN, UNDO, NOTE, ANSWER, END).
   - Never read `games/*.jsonl` directly while a game is in play: the deal line holds the hidden deck.
3. **Exploratory games** (the DEAL or a MARK line says EXPLORATORY): no routine questions. Discuss strategy and visible positions when the player asks, never hidden cards. Annotate only what the player asks you to keep. A MARK back to a method game restores the usual rules from that point.
4. For each PLAY or TURN in a method game:
   - **With a note:** catalog it with `python3 tools/annotate.py --n N --codes ... --source note --quote "..." --summary "..."`.
   - **No note, but the question rules say to ask:** run `python3 tools/ask.py --n N --play "A♥h" "Short question?"`. The question appears in the game's panel. Ask only when no other question is open.
   - **No note:** code it from the existing codes yourself (`--source inferred`, with a confidence), using the watcher's `new:` list and play tags (`[reveals]`, `[frees …]`, `[empties …: no king]`). Ask only for a possible missed play (visible cards only) or a genuinely new edge case.
5. **ANSWER** (or the player answers in the terminal): record a terminal answer with `python3 tools/ask.py --answer "..."`. Then annotate that action with `--source answer`.
6. **A reason no code covers:** suggest a code in one line ("New: `surface_soon`, Surface soon: … OK?"). On a yes, run `tools/annotate.py --propose ...` and then `--adopt`, and use it. If the words refine an existing code instead, update it (`--update CODE --definition "..."`) and mention it in one line.
7. **Keep the terminal quiet:** at most one short line per event you act on. In method games, never comment on the quality of a play or suggest a play. Never mention what a hidden card might be.
8. **Server and page:** a change to `server.py` needs the player to restart the server (Ctrl+C, `playlab`) and reload; a change to `ui/`, `index.html` or `styles.css` needs only a reload; tool changes need nothing. Say which, every time.
9. **On END:**
   - Give a 2–3 line tally: actions, decisions, notes, and questions asked and answered.
   - Ask whether to `/review` now or keep playing.
   - Keep following for the next deal.
