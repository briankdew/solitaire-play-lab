#!/usr/bin/env python3
"""How well the models explain the player's choices, from the recorded games.

    python3 tools/report.py                 # every finished game: agreement, by situation, unexplained plays
    python3 tools/report.py --game ID --plays   # one game, play by play (for /review)

A decision is a play the player chose (not the automatic finish) when there were 2 or more plays.
Scores are worked out again from the logged factors with the current model/valuation.json (and
model/learned.json if tools/fit.py has made one), so a change of values shows straight away.
A tie for the top score counts as a share: picking 1 of 2 tied plays is half a match.
"""
import argparse
import os
import sys
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def match(decision, valuation):
    s = L.score(decision["plays"], valuation)
    top = L.picks(s)
    return (1 / len(top) if decision["key"] in top else 0.0), s, top


def finished(events):
    return any(e.get("type") == "end" for e in events)


def situation(d):
    n = len(d["plays"])
    keys = {p["key"] for p in d["plays"]}
    home = any(p["factors"].get("home") for p in d["plays"])
    return [f"{n if n < 5 else '5+'} plays", "stock can turn" if "s" in keys else "no stock turn",
            "a home play available" if home else "no home play", "chose the stock" if d["key"] == "s" else "chose a card play"]


def overall(models):
    games = [g for g in L.all_games() if finished(L.read_lines(L.game_path(g)))]
    rows = []
    for g in games:
        for d in L.decisions(L.read_lines(L.game_path(g))):
            rows.append((g, d))
    print(f"{len(games)} finished games, {len(rows)} decisions (2+ plays, not automatic).")
    if not rows:
        return
    by = defaultdict(lambda: defaultdict(lambda: [0.0, 0]))
    unexplained = []
    for g, d in rows:
        hits = {}
        for name, val in models.items():
            m, _, _ = match(d, val)
            hits[name] = m
            for sit in ["all"] + situation(d):
                by[sit][name][0] += m
                by[sit][name][1] += 1
        if not any(hits.values()):
            unexplained.append((g, d))
    names = list(models)
    print("\nShare of decisions where the model picks the player's play")
    print(f"{'situation':28}" + "".join(f"{n:>14}" for n in names) + f"{'decisions':>11}")
    for sit in sorted(by, key=lambda s: (s != "all", s)):
        row = by[sit]
        count = row[names[0]][1]
        print(f"{sit:28}" + "".join(f"{row[n][0] / row[n][1]:>13.0%} " for n in names) + f"{count:>11}")
    print(f"\nPlays no model picks ({len(unexplained)}):")
    for g, d in unexplained[:40]:
        print(f"  {g} #{d['n']}: {d['text']} | {L.view_text(d.get('view'))} | note: {d.get('note') or '-'}")
    if len(unexplained) > 40:
        print(f"  … and {len(unexplained) - 40} more")


def one_game(game, models):
    events = L.read_lines(L.game_path(game))
    if not events:
        sys.exit(f"No game {game}.")
    if not finished(events):
        sys.exit("That game is still being played (no end event): review it once it ends.")
    standing, all_actions = L.standing_actions(events)
    notes = defaultdict(list)
    for e in events:
        if e.get("type") == "note":
            notes[e.get("after")].append(e["text"])
        if e.get("type") == "answer":
            notes[e.get("n")].append(f"answer: {e['text']}")
    ann = defaultdict(list)
    for a in L.read_lines(L.ANNOTATIONS):
        if a.get("game") == game:
            ann[a["n"]].append(a)
    deal = events[0]
    print(f"Game {game}, setup {deal.get('setup')}: deal {deal.get('deal')}")
    end = next((e for e in events if e.get("type") == "end"), {})
    print(f"Result: {end.get('result')} in {end.get('moves')} moves\n")
    for a in all_actions:
        flag = " (undone)" if a["undone"] else ""
        auto = " (automatic)" if a.get("auto") else ""
        print(f"#{a['n']} {a['text']}{flag}{auto}  after {(a.get('think_ms') or 0) / 1000:.1f}s")
        print(f"   saw   {L.view_text(a.get('view'))}")
        for name, val in models.items():
            s = L.score(a.get("plays") or [], val)
            top = L.picks(s)
            ok = "matches" if a["key"] in top else "differs"
            listing = " | ".join(f"{p['text']} {s[p['key']]:g}{'*' if p['key'] in top else ''}" for p in a.get("plays") or [])
            print(f"   {name:8} {listing}  -> {ok}")
        if a.get("note"):
            print(f"   note  \"{a['note']}\"")
        for extra in notes.get(a["n"], []):
            print(f"   {extra}")
        for x in ann.get(a["n"], []):
            print(f"   coded {', '.join(x['codes'])} ({x['source']}): {x.get('summary') or ''}")
        if a.get("revealed"):
            print(f"   revealed {L.card_text(a['revealed'])}")
    gaps = [a for a in L.decisions(events) if not a.get("note") and not ann.get(a["n"]) and not notes.get(a["n"])]
    print(f"\nDecisions with no note, answer or code: {', '.join('#%d %s' % (a['n'], a['text']) for a in gaps) or 'none'}")


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--game")
    p.add_argument("--plays", action="store_true")
    a = p.parse_args()
    models = {"values": L.load_valuation("valuation")}
    learned = L.load_valuation("learned")
    if learned:
        models["learned"] = learned
    if a.game or a.plays:
        one_game(a.game or L.newest_game(), models)
    else:
        overall(models)


if __name__ == "__main__":
    main()
