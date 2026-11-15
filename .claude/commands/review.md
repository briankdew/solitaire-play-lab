---
description: Go over a finished game with the player: fill gaps, refine reasons, suggest value changes
argument-hint: "[game id] (default: the latest finished game)"
---
Review a finished game: $ARGUMENTS

1. **Pick the game:** the id given, or the newest game in `games/` whose log ends with an `end` event. Never review a game still being played.
2. **List its plays:** run `python3 tools/report.py --game ID --plays`. It prints each standing action with the position seen, the plays and their scores, the model's pick, the note, the answers, and any annotation. Undone actions are listed too, since a change of mind is data.
3. **Find the gaps:**
   - real choices with no note or annotation,
   - plays the model got wrong,
   - notes not yet coded,
   - undone plays.
   Take them with the player one at a time, as short questions, in game order. Annotate each answer (`tools/annotate.py --source answer`). Mark it `--source inferred --confidence low` only when the player says your reading is right.
4. **Patterns:** if the same reason keeps explaining plays the model misses, suggest one change to `model/valuation.json`: a value, or a new factor in `lab/features.js` if no factor measures it. Show the before and after scores for the plays it would change. Make the change only when the player agrees, then run `npm test`.
5. **Write the summary:** save `catalog/reviews/<game-id>.md` with:
   - the result,
   - decisions and how many the model matched,
   - new or changed codes,
   - open questions the player wants to come back to.
6. **Commit:** commit `games/`, `catalog/` and any model change with a short message, and push.
