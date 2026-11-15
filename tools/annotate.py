#!/usr/bin/env python3
"""Catalog a play: Claude's reading of why the player chose it, in catalog/annotations.jsonl.

    python3 tools/annotate.py --n 5 --codes home,set_up_reveal --source note \
        --quote "starts the spade pile" --summary "Home play that also opens column a"
    python3 tools/annotate.py --propose surface_soon --name "Surface soon" \
        --definition "..."            # a new reason code, 'proposed' until the player agrees
    python3 tools/annotate.py --adopt surface_soon   # the player agreed
    python3 tools/annotate.py --list                 # the codes

--source says where the reason came from: note (the player's note), answer (an answer to a
question), or inferred (Claude's reading, no words from the player). Codes must be in
catalog/reasons.json (adopted or proposed).
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def load_reasons():
    return L.read_json(L.REASONS, {"reasons": []})


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--n", type=int, help="the action (the # in watch.py)")
    p.add_argument("--game", help="game id (default: the current game)")
    p.add_argument("--codes", help="comma-separated reason codes")
    p.add_argument("--source", choices=["note", "answer", "inferred"], default="note")
    p.add_argument("--quote", help="the player's words, as said")
    p.add_argument("--summary", help="one sentence: why this play")
    p.add_argument("--confidence", choices=["low", "medium", "high"], default="medium")
    p.add_argument("--propose", metavar="CODE")
    p.add_argument("--name")
    p.add_argument("--definition")
    p.add_argument("--factors", default="", help="lab/features.js factors it matches, comma-separated")
    p.add_argument("--adopt", metavar="CODE")
    p.add_argument("--list", action="store_true")
    a = p.parse_args()
    data = load_reasons()
    codes = {r["code"]: r for r in data["reasons"]}

    if a.list:
        for r in data["reasons"]:
            print(f"{r['code']:16} {r['status']:9} {r['definition']}")
        return
    if a.propose:
        if a.propose in codes:
            sys.exit(f"{a.propose} already exists.")
        if not (a.name and a.definition):
            sys.exit("--propose needs --name and --definition")
        data["reasons"].append({"code": a.propose, "name": a.name, "definition": a.definition,
                                "factors": [f for f in a.factors.split(",") if f], "status": "proposed",
                                "source": f"proposed in play, {L.now()[:10]}"})
        L.write_json(L.REASONS, data)
        print(f"Proposed {a.propose}.")
        return
    if a.adopt:
        if a.adopt not in codes:
            sys.exit(f"No code {a.adopt}.")
        codes[a.adopt]["status"] = "adopted"
        L.write_json(L.REASONS, data)
        print(f"Adopted {a.adopt}.")
        return

    if a.n is None or not a.codes:
        p.error("give --n and --codes (or --propose / --adopt / --list)")
    wanted = [c.strip() for c in a.codes.split(",") if c.strip()]
    unknown = [c for c in wanted if c not in codes]
    if unknown:
        sys.exit(f"Unknown code(s): {', '.join(unknown)}. Propose them first (--propose).")
    game = a.game or L.current_game()
    action = next((e for e in L.read_lines(L.game_path(game)) if e.get("type") in ("move", "turn") and e.get("n") == a.n), None)
    if not action:
        sys.exit(f"No action #{a.n} in {game}.")
    L.append_line(L.ANNOTATIONS, {
        "t": L.now(), "game": game, "n": a.n, "key": action.get("key"), "play": action.get("text"),
        "codes": wanted, "source": a.source, "quote": a.quote, "summary": a.summary, "confidence": a.confidence,
    })
    print(f"Annotated #{a.n} {action.get('text')}: {', '.join(wanted)}")


if __name__ == "__main__":
    main()
