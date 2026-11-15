#!/usr/bin/env python3
"""The index of played shuffles: shuffle IDs, mirror groups, and how often each shuffle was played.

A shuffle ID is <setup>-<counter>-<fingerprint>, e.g. K473-000001-7f3a9c21d4e8:
  setup        high card, suits, columns, draw (the same deck order under another setup is
               another shuffle)
  counter      6 digits, numbering the shuffles of that setup in the order they were first dealt
               (it simply grows past 999999)
  fingerprint  the first 12 hex digits of SHA-256 of "<setup>:<deck order, top card first>";
               the same shuffle always gets the same fingerprint, and it shows no cards
A shuffle's mirror group is the same kind of fingerprint, taken of the first (in sorted order) of
the deck orders made by trading suits of the same colour, or trading the two colours (the rules
only care about colour). Shuffles that are mirrors of each other share a mirror group; nothing is
merged.

The index is games/index.jsonl, one line per record, only ever appended:
  {"type": "shuffle", "id", "setup", "n", "fingerprint", "mirror", "deck", "t"}
  {"type": "deal", "game", "shuffle", "t"}
  {"type": "end", "game", "result", "moves", "t"}
It holds the hidden deck orders: not to be read while a game is being played (see CLAUDE.md).

    python3 shuffles.py --rebuild    # rebuild games/index.jsonl from the game logs
"""
import hashlib
import itertools
import json
import os
import sys

FINGERPRINT_LEN = 12
COUNTER_DIGITS = 6
COLOURS = (("S", "C"), ("H", "D"))   # black, red


def fingerprint(setup, deck):
    return hashlib.sha256(f"{setup}:{' '.join(deck)}".encode("utf-8")).hexdigest()[:FINGERPRINT_LEN]


def suit_maps(suits):
    """Every relabelling of the suits in play that keeps the game the same: suits trade within a
    colour, and the two colours may trade as wholes (when they have as many suits each)."""
    black = [s for s in COLOURS[0] if s in suits]
    red = [s for s in COLOURS[1] if s in suits]
    maps = []
    for b in itertools.permutations(black):
        for r in itertools.permutations(red):
            maps.append(dict(zip(black + red, list(b) + list(r))))
            if len(black) == len(red):
                maps.append(dict(zip(black + red, list(r) + list(b))))
    return maps


def mirror_group(setup, deck):
    suits = sorted({c[1] for c in deck})
    versions = [[c[0] + m[c[1]] for c in deck] for m in suit_maps(suits)]
    return fingerprint(setup, min(versions, key=lambda d: " ".join(d)))


def shuffle_id(setup, n, fp):
    return f"{setup}-{n:0{COUNTER_DIGITS}d}-{fp}"


class Index:
    """The shuffles played so far, kept in memory and appended to games/index.jsonl."""

    def __init__(self, path):
        self.path = path
        self.shuffles = {}      # fingerprint -> record (with "stats")
        self.by_id = {}         # id -> record
        self.counters = {}      # setup -> highest counter
        self.game_shuffle = {}  # game id -> fingerprint
        self.mirrors = {}       # mirror group -> [fingerprints], in order first dealt
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        try:
                            self._apply(json.loads(line))
                        except (ValueError, KeyError):
                            pass

    def _apply(self, rec):
        t = rec.get("type")
        if t == "shuffle":
            rec = dict(rec, stats={"plays": 0, "W": 0, "L": 0, "quit": 0, "abandoned": 0, "last": None})
            self.shuffles[rec["fingerprint"]] = rec
            self.by_id[rec["id"]] = rec
            self.counters[rec["setup"]] = max(self.counters.get(rec["setup"], 0), rec["n"])
            self.mirrors.setdefault(rec["mirror"], []).append(rec["fingerprint"])
        elif t == "deal":
            s = self.by_id.get(rec["shuffle"])
            if s:
                self.game_shuffle[rec["game"]] = s["fingerprint"]
                s["stats"]["plays"] += 1
                s["stats"]["last"] = rec.get("t")
        elif t == "end":
            fp = self.game_shuffle.get(rec["game"])
            if fp and rec.get("result") in ("W", "L", "quit", "abandoned"):
                self.shuffles[fp]["stats"][rec["result"]] += 1

    def _write(self, rec):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._apply(rec)

    def deal(self, game, setup, deck, t):
        """A game was dealt from this shuffle. Returns (record, first time dealt)."""
        fp = fingerprint(setup, deck)
        first = fp not in self.shuffles
        if first:
            n = self.counters.get(setup, 0) + 1
            self._write({"type": "shuffle", "id": shuffle_id(setup, n, fp), "setup": setup, "n": n,
                         "fingerprint": fp, "mirror": mirror_group(setup, deck), "deck": list(deck), "t": t})
        rec = self.shuffles[fp]
        self._write({"type": "deal", "game": game, "shuffle": rec["id"], "t": t})
        return rec, first

    def end(self, game, result, moves, t):
        if game in self.game_shuffle:
            self._write({"type": "end", "game": game, "result": result, "moves": moves, "t": t})

    def mirror_of(self, rec):
        """The other shuffles in this shuffle's mirror group, by id."""
        return [self.shuffles[fp]["id"] for fp in self.mirrors.get(rec["mirror"], []) if fp != rec["fingerprint"]]

    def summary(self, rec):
        """A record for the replay list: everything but the deck."""
        return {"id": rec["id"], "setup": rec["setup"], "n": rec["n"], "fingerprint": rec["fingerprint"],
                "mirror": rec["mirror"], "mirror_of": self.mirror_of(rec), "first": rec["t"], **rec["stats"]}

    def setups(self):
        out = {}
        for rec in self.shuffles.values():
            out[rec["setup"]] = out.get(rec["setup"], 0) + 1
        return dict(sorted(out.items()))

    def listing(self, setup=None, q="", offset=0, limit=50):
        """Shuffles of a setup, newest counter first, filtered by a counter number or part of an id."""
        recs = [r for r in self.shuffles.values() if not setup or r["setup"] == setup]
        q = (q or "").strip().lower()
        if q:
            if q.isdigit():   # a number is a counter: 7 finds 000007
                recs = [r for r in recs if r["n"] == int(q)]
            else:
                recs = [r for r in recs if q in r["id"].lower()]
        recs.sort(key=lambda r: (r["setup"], -r["n"]))
        return {"total": len(recs), "items": [self.summary(r) for r in recs[offset:offset + limit]]}

    def get(self, shuffle):
        return self.by_id.get(shuffle)


def rebuild(games_dir):
    """Rebuild games/index.jsonl from the game logs, in the order the games were dealt."""
    path = os.path.join(games_dir, "index.jsonl")
    deals = []
    for name in os.listdir(games_dir):
        if not name.endswith(".jsonl") or name == "index.jsonl":
            continue
        game = name[:-6]
        deal, end = None, None
        with open(os.path.join(games_dir, name), encoding="utf-8") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if e.get("type") == "deal" and deal is None:
                    deal = e
                elif e.get("type") == "end":
                    end = e
        if deal and deal.get("deck") and deal.get("setup"):
            deals.append((deal.get("t") or "", game, deal, end))
    deals.sort()
    tmp = path + ".rebuild"
    if os.path.exists(tmp):
        os.remove(tmp)
    index = Index(tmp)
    for t, game, deal, end in deals:
        index.deal(game, deal["setup"], deal["deck"], t)
        if end:
            index.end(game, end.get("result"), end.get("moves"), end.get("t"))
    if os.path.exists(tmp):
        os.replace(tmp, path)
    elif os.path.exists(path):
        os.remove(path)
    return len(index.shuffles), len(deals)


if __name__ == "__main__":
    if sys.argv[1:] == ["--rebuild"]:
        here = os.path.dirname(os.path.abspath(__file__))
        shuffles, games = rebuild(os.path.join(os.environ.get("LAB_DATA", here), "games"))
        print(f"Rebuilt games/index.jsonl: {shuffles} shuffles from {games} games.")
    else:
        print(__doc__)
