#!/usr/bin/env python3
"""Learn values for the factors from the player's own choices, and compare them with model/valuation.json.

    python3 tools/fit.py              # fit on every finished game, write model/learned.json
    python3 tools/fit.py --dry-run    # show the result without writing it

The method is a standard choice model (conditional logit): in each decision, the chance of a play
is proportional to exp(its total), and the values are the ones that make the player's actual
choices most likely. A small penalty keeps values near 0 when there's little evidence (--penalty).
It needs a fair number of decisions; with a handful of games the learned values are only a hint.
Standard library only.
"""
import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def collect():
    rows = []
    for g in L.all_games():
        events = L.read_lines(L.game_path(g))
        if not any(e.get("type") == "end" for e in events):
            continue
        for d in L.decisions(events):
            keys = [p["key"] for p in d["plays"]]
            if d["key"] in keys:
                rows.append(([p["factors"] for p in d["plays"]], keys.index(d["key"]), d["plays"]))
    return rows


def fit(rows, names, penalty, steps=3000, rate=0.5):
    w = {n: 0.0 for n in names}
    for _ in range(steps):
        grad = {n: -penalty * w[n] for n in names}
        for options, chosen, _ in rows:
            totals = [sum(w[n] * f.get(n, 0) for n in names) for f in options]
            top = max(totals)
            exps = [math.exp(t - top) for t in totals]
            z = sum(exps)
            for n in names:
                expected = sum(e * f.get(n, 0) for e, f in zip(exps, options)) / z
                grad[n] += options[chosen].get(n, 0) - expected
        for n in names:
            w[n] += rate * grad[n] / max(1, len(rows))
    return w


def log_likelihood(rows, valuation):
    """How likely the player's choices are under a valuation (scored as lab/model.js does)."""
    ll = 0.0
    for _, chosen, plays in rows:
        scores = L.score(plays, valuation)
        totals = [scores[p["key"]] for p in plays]
        top = max(totals)
        z = sum(math.exp(t - top) for t in totals)
        ll += totals[chosen] - top - math.log(z)
    return ll


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--penalty", type=float, default=0.1)
    p.add_argument("--dry-run", action="store_true")
    a = p.parse_args()
    rows = collect()
    if not rows:
        sys.exit("No decisions yet: play some games first.")
    names = sorted({n for options, _, _ in rows for f in options for n in f})
    learned = fit(rows, names, a.penalty)
    valuation = L.load_valuation("valuation") or {"values": {}}
    hand = valuation.get("values", {})
    print(f"{len(rows)} decisions. Values (yours -> learned from your choices):")
    for n in names:
        print(f"  {n:18} {hand.get(n, 0):>6.2f} -> {learned[n]:>6.2f}")
    rnd = sum(-math.log(len(o)) for o, _, _ in rows)   # choosing at random, for reference
    print(f"\nFit (log-likelihood, higher is better): random {rnd:.1f}, "
          f"your values {log_likelihood(rows, valuation):.1f}, "
          f"learned {log_likelihood(rows, {'values': learned, 'draw_baseline': False}):.1f}")
    if not a.dry_run:
        L.write_json(os.path.join(L.ROOT, "model", "learned.json"), {
            "name": "learned from play",
            "about": f"Fitted by tools/fit.py on {len(rows)} decisions ({L.now()[:10]}). Not edited by hand.",
            "draw_baseline": False,
            "values": {n: round(v, 3) for n, v in learned.items()},
        })
        print("Wrote model/learned.json (tools/report.py now compares it too).")


if __name__ == "__main__":
    main()
