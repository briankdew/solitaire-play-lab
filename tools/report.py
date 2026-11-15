#!/usr/bin/env python3
"""What the recorded games hold so far: decisions, how many are explained, and the reasons used.

    python3 tools/report.py                     # every finished game: totals and reason counts
    python3 tools/report.py --game ID --plays   # one game, play by play (for /review)

A decision is a play the player chose (not the automatic finish) when there were 2 or more plays.
A decision is explained when it has a note, an answer to a question, or a coded reason.
Nothing here judges a play.
"""
import argparse
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def finished(events):
    return any(e.get("type") == "end" for e in events)


def extras(events):
    """Notes sent on their own and answers, by action number."""
    out = defaultdict(list)
    for e in events:
        if e.get("type") == "note":
            out[e.get("after")].append(f'note: "{e["text"]}"')
        if e.get("type") == "answer":
            out[e.get("n")].append(f'answer: "{e["text"]}"')
    return out


def annotations(game=None):
    out = defaultdict(list)
    for a in L.read_lines(L.ANNOTATIONS):
        if game is None or a.get("game") == game:
            out[(a.get("game"), a.get("n"))].append(a)
    return out


def overall():
    games = [g for g in L.all_games() if finished(L.read_lines(L.game_path(g)))]
    ann = annotations()
    total = explained = undone = 0
    results = Counter()
    codes = Counter()
    for g in games:
        events = L.read_lines(L.game_path(g))
        end = next((e for e in events if e.get("type") == "end"), {})
        results[end.get("result")] += 1
        more = extras(events)
        for d in L.decisions(events):
            total += 1
            if d.get("note") or more.get(d["n"]) or ann.get((g, d["n"])):
                explained += 1
        undone += sum(1 for e in events if e.get("type") == "undo")
    for items in ann.values():
        for a in items:
            codes.update(a.get("codes", []))
    print(f"{len(games)} finished games: " + ", ".join(f"{k} {v}" for k, v in results.items()))
    print(f"{total} decisions (2+ plays, not automatic), {explained} explained, {undone} undos")
    if codes:
        print("\nReasons used:")
        for code, n in codes.most_common():
            print(f"  {code:20} {n}")


def one_game(game):
    events = L.read_lines(L.game_path(game))
    if not events:
        sys.exit(f"No game {game}.")
    if not finished(events):
        sys.exit("That game is still being played (no end event): review it once it ends.")
    _, all_actions = L.standing_actions(events)
    more = extras(events)
    ann = annotations(game)
    deal = events[0]
    end = next((e for e in events if e.get("type") == "end"), {})
    print(f"Game {game}, setup {deal.get('setup')}: deal {deal.get('deal')}")
    print(f"Result: {end.get('result')} in {end.get('moves')} moves\n")
    for a in all_actions:
        flag = " (undone)" if a["undone"] else ""
        auto = " (automatic)" if a.get("auto") else ""
        print(f"#{a['n']} {a['text']}{flag}{auto}  after {(a.get('think_ms') or 0) / 1000:.1f}s")
        print(f"   saw   {L.view_text(a.get('view'))}")
        print(f"   plays {L.plays_text(a)}")
        if a.get("note"):
            print(f'   note  "{a["note"]}"')
        for x in more.get(a["n"], []):
            print(f"   {x}")
        for x in ann.get((game, a["n"]), []):
            print(f"   coded {', '.join(x['codes'])} ({x['source']}): {x.get('summary') or ''}")
        if a.get("revealed"):
            print(f"   revealed {L.card_text(a['revealed'])}")
    gaps = [a for a in L.decisions(events) if not a.get("note") and not more.get(a["n"]) and not ann.get((game, a["n"]))]
    print(f"\nDecisions with no note, answer or code: {', '.join('#%d %s' % (a['n'], a['text']) for a in gaps) or 'none'}")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--game")
    p.add_argument("--plays", action="store_true")
    a = p.parse_args()
    if a.game or a.plays:
        one_game(a.game or L.newest_game())
    else:
        overall()


if __name__ == "__main__":
    main()
