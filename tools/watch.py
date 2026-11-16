#!/usr/bin/env python3
"""Print the game being played, one line per event, for Claude to follow during play.

    python3 tools/watch.py            # the current game so far, then stop
    python3 tools/watch.py --follow   # keep following, switching to each new game as it's dealt
    python3 tools/watch.py --game ID  # a particular game

Only what the player could see is printed: the hidden deck order in the deal event is never shown.
Each line starts with a tag: DEAL, PLAY, TURN, UNDO, NOTE, ANSWER, END.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def secs(ms):
    return f"{(ms or 0) / 1000:.1f}s"


def _plays(e):
    text, new = L.plays_facts_text(e)
    return text, e.get("choices", 0), new


def describe(e):
    t = e.get("type")
    if t == "deal":
        shuffle = ""
        if e.get("shuffle"):
            shuffle = f" | shuffle {e['shuffle']} ({'new' if e.get('first_deal') else 'REPLAY: do not read earlier games of this shuffle while it is in play'})"
        kind = " | EXPLORATORY: discuss when asked, no routine questions" if e.get("exploratory") else ""
        return (f"DEAL {e.get('setup')} game {e.get('_game')}{shuffle}{kind} | {L.view_text(e.get('view'))}"
                f" | plays: {L.plays_text(e)}" + (f' | note: "{e["note"]}"' if e.get("note") else ""))
    if t in ("move", "turn"):
        tag = "PLAY" if t == "move" else "TURN"
        who = " auto" if e.get("auto") else ""
        num = f" move {e['move_no']}" if e.get("move_no") else ""
        parts = [f"{tag} #{e.get('n')}{num}{who}: {e.get('text')} ({e.get('token')}) after {secs(e.get('think_ms'))}",
                 f"saw {L.view_text(e.get('view'))}",
                 "plays: {} ({} choices) | new: {}".format(*_plays(e))]
        if e.get("retake"):
            parts.append("take-back to a column")
        if e.get("revealed"):
            parts.append(f"revealed {L.card_text(e['revealed'])}")
        if e.get("turned"):
            parts.append("turned up " + " ".join(L.card_text(c) for c in e["turned"]))
        parts.append(f'note: "{e["note"]}"' if e.get("note") else "no note")
        return " | ".join(parts)
    if t == "mark":
        return (f"MARK after #{e.get('after')}: now EXPLORATORY (discuss when asked)" if e.get("exploratory")
                else f"MARK after #{e.get('after')}: now a method game (back to the usual rules)")
    if t == "undo":
        return f"UNDO #{e.get('undoes')}" + (" (take-back)" if e.get("retake") else "") + (f' | note: "{e["note"]}"' if e.get("note") else "")
    if t == "note":
        return f'NOTE after #{e.get("after")}: "{e.get("text")}"'
    if t == "answer":
        return f'ANSWER to {e.get("question_id")} (#{e.get("n")}): "{e.get("text")}"'
    if t == "end":
        res = {"W": "won", "L": "lost (End game)", "quit": "quit", "abandoned": "abandoned (new deal)"}.get(e.get("result"), e.get("result"))
        return f"END {res} in {e.get('moves')} moves" + (f' | note: "{e["note"]}"' if e.get("note") else "")
    return f"{(t or '?').upper()} {e}"


def run(game, follow):
    seen = 0
    while True:
        target = L.current_game() if follow else game
        if follow and target != game:
            game, seen = target, 0
        if game:
            events = L.read_lines(L.game_path(game))
            for e in events[seen:]:
                e["_game"] = game
                print(describe(e), flush=True)
            seen = len(events)
        if not follow:
            if not game:
                print("No games yet.")
            return
        time.sleep(0.5)


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--follow", action="store_true")
    p.add_argument("--game")
    a = p.parse_args()
    try:
        run(a.game or L.current_game(), a.follow and not a.game)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
