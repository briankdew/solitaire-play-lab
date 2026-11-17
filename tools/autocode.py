#!/usr/bin/env python3
"""Follow the game like watch.py, coding the clear-cut actions itself and printing only the rest.

    python3 tools/autocode.py --follow            # live: code clear cases, print what needs Claude
    python3 tools/autocode.py --game ID --check   # compare with Claude's codes in a finished game

Clear cases (method games, no note), coded with --source inferred:
  - a draw with no new play                       -> NNP
  - an ace home                                   -> direct_home, foundation_set
  - a two home, or any play home that was the only new play -> direct_home
  - a king to an empty column, the only new play  -> king_column, kings_out
  - any other only new play, and the player made it -> ONP
Extra nuance (most_hidden, setup_play, ...) is left for /review.
Everything else is printed as watch.py prints it, for Claude: a choice among several new plays, a play
other than the new one, a draw made when a new play existed, notes, answers, undos, deals and ends.
Actions already annotated are never coded again or reprinted (so re-arming catches up without repeats).
Exploratory games are not coded; their plays are not printed (run watch.py when the player asks).
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402
import watch as W  # noqa: E402


def new_keys(e):
    """The new plays of action event e by key: freshly available and useful (as watch.py's `new:`)."""
    view = e.get("view")
    fresh = L.fresh_keys(e.get("_prev"), e)
    return [p["key"] for p in e.get("plays") or []
            if p["key"] in fresh and L.play_fact(view, p["key"])[1]]


def clear_codes(e):
    """(codes, summary) for a clear-cut action, or None when Claude should look at it."""
    if e.get("note"):
        return None
    key, text = e.get("key"), e.get("text")
    new = new_keys(e)
    if e.get("type") == "turn":
        return (["NNP"], "No new play; drawing.") if not new else None
    card, dest = key[:2], key[2:]
    if dest == "h" and card[0] == "A":
        return ["direct_home", "foundation_set"], "Ace straight home."
    if dest == "h" and (card[0] == "2" or new == [key]):
        return ["direct_home"], f"{text} straight home."
    if new == [key]:
        if card[0] == "K" and (L.play_identity(e.get("view"), key) or ("", ""))[1].startswith("empty"):
            return ["king_column", "kings_out"], "King to the empty column; the only new play."
        return ["ONP"], f"The only new play: {text}."
    return None


def annotated(game):
    return {a.get("n") for a in L.read_lines(L.ANNOTATIONS) if a.get("game") == game}


def write(game, e, codes, summary):
    L.append_line(L.ANNOTATIONS, {
        "t": L.now(), "game": game, "n": e.get("n"), "key": e.get("key"), "play": e.get("text"),
        "codes": codes, "source": "inferred", "exploratory": False, "quote": None,
        "summary": summary, "confidence": "high", "by": "autocode",
    })


def run(game, follow):
    seen, standing, explore, auto = 0, [], False, 0
    while True:
        target = L.current_game() if follow else game
        if follow and target != game:
            game, seen, standing, explore, auto = target, 0, [], False, 0
        if game:
            events = L.read_lines(L.game_path(game))
            done = annotated(game) if len(events) > seen else set()
            first = seen == 0
            for e in events[seen:]:
                e["_game"] = game
                W.track(standing, e)
                t = e.get("type")
                if t in ("deal", "mark") and "exploratory" in e:
                    explore = bool(e["exploratory"])
                if not follow and seen == 0 and L.is_exploratory(events):
                    explore = True      # a finished game counts as it ended (see CLAUDE.md)
                if t in ("move", "turn"):
                    if explore or e.get("n") in done:
                        continue
                    c = clear_codes(e)
                    if c:
                        write(game, e, *c)
                        auto += 1
                        continue
                elif first and follow:
                    continue            # catching up: only uncoded actions are reprinted
                line = W.describe(e)
                if t == "end":
                    line += f" | auto-coded {auto} actions this session"
                print(line, flush=True)
            seen = len(events)
        if not follow:
            return
        time.sleep(0.5)


def check(game):
    """Compare clear_codes with the codes Claude gave (latest annotation per action)."""
    events = L.read_lines(L.game_path(game))
    mine = {}
    for a in L.read_lines(L.ANNOTATIONS):
        if a.get("game") == game and a.get("by") != "autocode":
            mine.setdefault(a["n"], set()).update(a["codes"])
    standing, same, part, diff, left = [], 0, 0, 0, 0
    for e in events:
        W.track(standing, e)
        if e.get("type") not in ("move", "turn"):
            continue
        c = clear_codes(e)
        if not c:
            left += 1
            continue
        auto, theirs = set(c[0]), mine.get(e["n"]) or set()
        if auto - theirs:
            diff += 1
            print(f"#{e['n']} {e.get('text')}: auto {sorted(auto)} vs Claude {sorted(theirs)}")
        elif theirs - auto - {"dead_end"}:
            part += 1
        else:
            same += 1
    print(f"{same} match, {part} match with more codes from Claude, {diff} conflict, {left} left for Claude")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--follow", action="store_true")
    p.add_argument("--game")
    p.add_argument("--check", action="store_true", help="compare with Claude's codes; writes nothing")
    a = p.parse_args()
    game = a.game or L.current_game()
    if a.check:
        return check(game)
    try:
        run(game, a.follow and not a.game)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
