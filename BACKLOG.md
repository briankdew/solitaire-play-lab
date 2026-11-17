# Backlog

Items raised for later. The player decides when each is taken up; each starts with a discussion.

## Next
- Nothing waiting.

## Later
- **Flaky browser test:** "Delete asks first, moves the shuffle to Deleted, and Restore brings it back" still fails about one full run in three (passes alone). Find the remaining race. (Noted 2026-11-16.)
- **Play profiles:** play or replay shuffles with different strategies, or let other people play and record their reasoning. To settle: is a profile a person, a strategy or both; a reason vocabulary per profile (clean slate per player); how profiles show in logs, Played shuffle and the tools; how they relate to exploratory games. (Raised 2026-11-16.)
- **"Playlike" non-plays:** when *not* playing a card should be treated as a play-like decision (draws themselves are neutral actions, not plays). (Raised 2026-11-16.)
- **Hypothesis to test with the data:** "most games I've lost seem to have the most unplayed face-down cards" (player, 2026-11-16, game K473-000008 #41). Compare face-down cards left at the end of won and lost games.
- **Study data export:** once the platform is reasonably stable, a consistent, repeatable export ("data dump") of the games recorded here, to start gathering study data. (Raised 2026-11-16.)
- **Game replay for study:** rename Played shuffle's Replay to **New game** (deals the shuffle again), and make **Replay** a true, uninterruptible replay of a finished game's exact moves, "like replaying a chess match to learn from it": step through each action with its note, answers and coded reasons, without recording anything. To settle: step controls, how undos show, which games qualify. (Raised 2026-11-17.)
- **Terminology in the tools:** a draw isn't a play, but the logs, watch.py and report.py still list `s` among the "plays" and count it in "choices". Rename when it's convenient (log field names need care: older games use them).
