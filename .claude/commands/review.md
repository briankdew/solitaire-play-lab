---
description: Go over a finished game with the player: fill gaps, refine reasons, suggest value changes
argument-hint: "[game id] (default: the latest finished game)"
---
Review a finished game: $ARGUMENTS

1. **Pick the game:** the id given, or the newest game in `games/` whose log ends with an `end` event. Never review a game still being played.
2. **Code the clear cases first:** run `python3 tools/autocode.py --game ID` (method games only; it skips actions already annotated, so it's safe after `/play`). It codes the clear-cut actions (`NNP`, any play home `direct_home`, the only new play `ONP`, a king to an empty column) and prints the rest. Don't re-ask about what it coded, unless a note or answer says otherwise.
3. **List its plays:** run `python3 tools/report.py --game ID --plays`. It prints each action with the position seen, the plays available, the note, the answers, and any annotation. Undone actions are listed too; the player uses Undo only to correct a mistake, never as a change of mind, so don't ask about them.
4. **Find the gaps:**
   - real choices with no note or annotation,
   - notes not yet coded.
   Take them with the player one at a time, as short questions, in game order. Annotate each answer (`tools/annotate.py --source answer`). Mark it `--source inferred --confidence low` only when the player says your reading is right.
5. **Patterns:** if the player's words keep describing the same idea, suggest a code for it or a sharper definition of an existing one, in their words. Change `catalog/reasons.json` only when the player agrees. Don't suggest values or weights unless the player asks.
6. **Write the summary:** save `catalog/reviews/<game-id>.md` with:
   - the result,
   - decisions and how many were explained,
   - new or changed codes,
   - open questions the player wants to come back to.
7. **Commit:** commit `games/` and `catalog/` with a short message, and push.
