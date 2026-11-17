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

Each game is a method game (it counts toward modelling how the player plays) or an exploratory
game (the player is trying something out; kept apart from the model). A game's kind is the one it
had when it ended; the player can switch it until then.

The index is games/index.jsonl, one line per record, only ever appended:
  {"type": "shuffle", "id", "setup", "n", "fingerprint", "mirror", "deck", "t"}
  {"type": "deal", "game", "shuffle", "exploratory", "t"}
  {"type": "mark", "game", "exploratory", "t"}            the game's kind switched
  {"type": "end", "game", "result", "moves", "t"}
  {"type": "delete", "shuffle", "t"}                      the shuffle and its games were deleted
It holds the hidden deck orders: not to be read while a game is being played (see CLAUDE.md).

Deleting a shuffle moves its game logs (and their coded reasons and reviews) to
games/deleted/<shuffle id>/, so it can be undone. Its counter number is never reused; dealing the
same cards again later makes a new shuffle with a new number.

    python3 shuffles.py --rebuild          # rebuild games/index.jsonl from the game logs
    python3 shuffles.py --restore ID       # undo a delete, under the same ID (stop ./play first)
"""
import hashlib
import itertools
import json
import os
import shutil
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


KINDS = ("method", "exploratory")
RESULTS = ("W", "L", "quit", "abandoned")


def kind_of(exploratory):
    return "exploratory" if exploratory else "method"


class Index:
    """The shuffles played so far, kept in memory and appended to games/index.jsonl."""

    def __init__(self, path):
        self.path = path
        self.shuffles = {}      # fingerprint -> shuffle record (live shuffles only)
        self.by_id = {}         # id -> shuffle record (live shuffles only)
        self.counters = {}      # setup -> highest counter ever used (deleted ones included)
        self.games = {}         # game id -> {"shuffle": fingerprint, "kind", "result", "t"}
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
            rec = dict(rec, game_ids=[])
            self.shuffles[rec["fingerprint"]] = rec
            self.by_id[rec["id"]] = rec
            self.counters[rec["setup"]] = max(self.counters.get(rec["setup"], 0), rec["n"])
            self.mirrors.setdefault(rec["mirror"], []).append(rec["fingerprint"])
        elif t == "deal":
            s = self.by_id.get(rec["shuffle"])
            if s:
                self.games[rec["game"]] = {"shuffle": s["fingerprint"], "kind": kind_of(rec.get("exploratory")),
                                           "result": None, "t": rec.get("t")}
                s["game_ids"].append(rec["game"])
        elif t == "mark":
            g = self.games.get(rec["game"])
            if g:
                g["kind"] = kind_of(rec.get("exploratory"))
        elif t == "end":
            g = self.games.get(rec["game"])
            if g and rec.get("result") in RESULTS:
                g["result"] = rec["result"]
        elif t == "delete":
            s = self.by_id.pop(rec["shuffle"], None)
            if s:
                del self.shuffles[s["fingerprint"]]
                self.mirrors[s["mirror"]].remove(s["fingerprint"])
                for game in s["game_ids"]:
                    self.games.pop(game, None)

    def _write(self, rec):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self._apply(rec)

    def deal(self, game, setup, deck, t, exploratory=False):
        """A game was dealt from this shuffle. Returns (record, first time dealt)."""
        fp = fingerprint(setup, deck)
        first = fp not in self.shuffles
        if first:
            n = self.counters.get(setup, 0) + 1
            self._write({"type": "shuffle", "id": shuffle_id(setup, n, fp), "setup": setup, "n": n,
                         "fingerprint": fp, "mirror": mirror_group(setup, deck), "deck": list(deck), "t": t})
        rec = self.shuffles[fp]
        self._write({"type": "deal", "game": game, "shuffle": rec["id"], "exploratory": bool(exploratory), "t": t})
        return rec, first

    def mark(self, game, exploratory, t):
        g = self.games.get(game)
        if g and g["result"] is None and g["kind"] != kind_of(exploratory):
            self._write({"type": "mark", "game": game, "exploratory": bool(exploratory), "t": t})

    def end(self, game, result, moves, t):
        if game in self.games:
            self._write({"type": "end", "game": game, "result": result, "moves": moves, "t": t})

    def delete(self, shuffle, t):
        if shuffle in self.by_id:
            self._write({"type": "delete", "shuffle": shuffle, "t": t})

    def mirror_of(self, rec):
        """The other shuffles in this shuffle's mirror group, by id."""
        return [self.shuffles[fp]["id"] for fp in self.mirrors.get(rec["mirror"], []) if fp != rec["fingerprint"]]

    def stats(self, rec, kind=None):
        """Games of a shuffle (of one kind, or all): plays, results and the last time dealt."""
        out = {"plays": 0, "W": 0, "L": 0, "quit": 0, "abandoned": 0, "last": None}
        for game in rec["game_ids"]:
            g = self.games[game]
            if kind and g["kind"] != kind:
                continue
            out["plays"] += 1
            if g["result"]:
                out[g["result"]] += 1
            out["last"] = g["t"]
        return out

    def has_kind(self, rec, kind):
        return any(self.games[g]["kind"] == kind for g in rec["game_ids"])

    def summary(self, rec, kind=None):
        """A record for the replay list: everything but the deck. Stats are for `kind` (or all
        games); `games` counts every game of the shuffle by kind."""
        both = {k: sum(1 for g in rec["game_ids"] if self.games[g]["kind"] == k) for k in KINDS}
        return {"id": rec["id"], "setup": rec["setup"], "n": rec["n"], "fingerprint": rec["fingerprint"],
                "mirror": rec["mirror"], "mirror_of": self.mirror_of(rec), "first": rec["t"],
                "games": both, "finished": self.finished(rec, kind), **self.stats(rec, kind)}

    def finished(self, rec, kind=None):
        """The shuffle's finished games (of `kind`, or all), newest first: [{game, result, t}], for
        Review (it copies /review <game id>)."""
        out = [{"game": g, "result": self.games[g]["result"], "t": self.games[g]["t"]} for g in rec["game_ids"]
               if self.games[g]["result"] and (not kind or self.games[g]["kind"] == kind)]
        return sorted(out, key=lambda x: x["t"] or "", reverse=True)

    def setups(self, kind=None):
        out = {}
        for rec in self.shuffles.values():
            if kind is None or self.has_kind(rec, kind):
                out[rec["setup"]] = out.get(rec["setup"], 0) + 1
        return dict(sorted(out.items()))

    def listing(self, setup=None, q="", offset=0, limit=50, kind=None):
        """Shuffles of a setup with games of `kind` (or any), newest counter first, filtered by a
        counter number or part of an id."""
        recs = [r for r in self.shuffles.values()
                if (not setup or r["setup"] == setup) and (kind is None or self.has_kind(r, kind))]
        q = (q or "").strip().lower()
        if q:
            if q.isdigit():   # a number is a counter: 7 finds 000007
                recs = [r for r in recs if r["n"] == int(q)]
            else:
                recs = [r for r in recs if q in r["id"].lower()]
        recs.sort(key=lambda r: (r["setup"], -r["n"]))
        return {"total": len(recs), "items": [self.summary(r, kind) for r in recs[offset:offset + limit]]}

    def get(self, shuffle):
        return self.by_id.get(shuffle)

    def game_ids(self, shuffle):
        rec = self.by_id.get(shuffle)
        return list(rec["game_ids"]) if rec else []


def _move_catalog_lines(src, dest, games):
    """Move the lines of a .jsonl file that belong to these games from src to dest."""
    if not os.path.exists(src):
        return
    keep, moved = [], []
    with open(src, encoding="utf-8") as f:
        for line in f:
            try:
                (moved if json.loads(line).get("game") in games else keep).append(line)
            except ValueError:
                keep.append(line)
    if moved:
        with open(dest, "a", encoding="utf-8") as f:
            f.writelines(moved)
        with open(src, "w", encoding="utf-8") as f:
            f.writelines(keep)


def delete_shuffle(index, games_dir, catalog_dir, shuffle, t):
    """Delete a shuffle: its games' logs, coded reasons and reviews move to games/deleted/<id>/.
    Returns the number of games moved, or None if there is no such shuffle."""
    games = set(index.game_ids(shuffle))
    if index.get(shuffle) is None:
        return None
    dest = os.path.join(games_dir, "deleted", shuffle)
    os.makedirs(dest, exist_ok=True)
    for game in games:
        src = os.path.join(games_dir, game + ".jsonl")
        if os.path.exists(src):
            shutil.move(src, os.path.join(dest, game + ".jsonl"))
        review = os.path.join(catalog_dir, "reviews", game + ".md")
        if os.path.exists(review):
            shutil.move(review, os.path.join(dest, game + ".md"))
    _move_catalog_lines(os.path.join(catalog_dir, "annotations.jsonl"), os.path.join(dest, "annotations.jsonl"), games)
    with open(os.path.join(dest, "deleted.json"), "w", encoding="utf-8") as f:
        json.dump({"shuffle": shuffle, "games": sorted(games), "t": t}, f, indent=2)
    index.delete(shuffle, t)
    return len(games)


def restore_shuffle(games_dir, catalog_dir, shuffle):
    """Undo a delete under the shuffle's original ID: its records go back into the index and its
    files back into place. Returns the number of games restored, or None if there is no such
    deleted shuffle. Raises ValueError if the same cards have since been dealt as a new shuffle."""
    src = os.path.join(games_dir, "deleted", shuffle)
    if not os.path.isdir(src):
        return None
    index = Index(os.path.join(games_dir, "index.jsonl"))
    setup, n, fp = shuffle.rsplit("-", 2)[0], int(shuffle.rsplit("-", 2)[1]), shuffle.rsplit("-", 2)[2]
    if fp in index.shuffles:
        raise ValueError(f"these cards were dealt again as {index.shuffles[fp]['id']}; delete that one first")
    names = [x for x in os.listdir(src) if x.endswith(".jsonl") and x != "annotations.jsonl"]
    games = sorted(((_read_game(os.path.join(src, x)), x[:-6]) for x in names), key=lambda g: g[0][0].get("t") or "")
    games = [(g, name) for g, name in games if g[0] and g[0].get("deck")]
    if games:
        first = games[0][0][0]
        index._write({"type": "shuffle", "id": shuffle, "setup": setup, "n": n, "fingerprint": fp,
                      "mirror": mirror_group(setup, first["deck"]), "deck": first["deck"], "t": first.get("t")})
        for (deal, marks, end), game in games:
            index._write({"type": "deal", "game": game, "shuffle": shuffle, "exploratory": bool(deal.get("exploratory")), "t": deal.get("t")})
            for m in marks:
                index._write({"type": "mark", "game": game, "exploratory": bool(m.get("exploratory")), "t": m.get("t")})
            if end:
                index._write({"type": "end", "game": game, "result": end.get("result"), "moves": end.get("moves"), "t": end.get("t")})
    for name in os.listdir(src):
        path = os.path.join(src, name)
        if name == "annotations.jsonl":
            with open(path, encoding="utf-8") as f, open(os.path.join(catalog_dir, "annotations.jsonl"), "a", encoding="utf-8") as out:
                out.write(f.read())
        elif name.endswith(".md"):
            os.makedirs(os.path.join(catalog_dir, "reviews"), exist_ok=True)
            shutil.move(path, os.path.join(catalog_dir, "reviews", name))
        elif name.endswith(".jsonl"):
            shutil.move(path, os.path.join(games_dir, name))
    shutil.rmtree(src)
    return len(games)


def _read_game(path):
    """A game log's deal, kind changes and end, for rebuilding the index."""
    deal, marks, end = None, [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if e.get("type") == "deal" and deal is None:
                deal = e
            elif e.get("type") == "mark":
                marks.append(e)
            elif e.get("type") == "end":
                end = e
    return deal, marks, end


def rebuild(games_dir):
    """Rebuild games/index.jsonl from the game logs, in the order things happened. Deleted
    shuffles (games/deleted/) are replayed and deleted again, so counter numbers stay the same."""
    path = os.path.join(games_dir, "index.jsonl")
    events = []   # (time, order, kind, data)

    def add_game(game, file):
        deal, marks, end = _read_game(file)
        if not (deal and deal.get("deck") and deal.get("setup")):
            return
        events.append((deal.get("t") or "", 0, "deal", (game, deal)))
        for m in marks:
            events.append((m.get("t") or "", 1, "mark", (game, m)))
        if end:
            events.append((end.get("t") or "", 2, "end", (game, end)))

    for name in os.listdir(games_dir):
        if name.endswith(".jsonl") and name != "index.jsonl":
            add_game(name[:-6], os.path.join(games_dir, name))
    deleted_dir = os.path.join(games_dir, "deleted")
    if os.path.isdir(deleted_dir):
        for shuffle in os.listdir(deleted_dir):
            folder = os.path.join(deleted_dir, shuffle)
            info = os.path.join(folder, "deleted.json")
            if not os.path.exists(info):
                continue
            with open(info, encoding="utf-8") as f:
                when = json.load(f).get("t") or ""
            for name in os.listdir(folder):
                if name.endswith(".jsonl") and name != "annotations.jsonl":
                    add_game(name[:-6], os.path.join(folder, name))
            events.append((when, 3, "delete", (shuffle, folder)))
    events.sort(key=lambda e: (e[0], e[1]))
    tmp = path + ".rebuild"
    if os.path.exists(tmp):
        os.remove(tmp)
    index = Index(tmp)
    folder_ids = {}   # deleted folder -> the id its shuffle gets in this rebuild
    deals = 0
    for t, _, kind, data in events:
        if kind == "deal":
            game, deal = data
            rec, _ = index.deal(game, deal["setup"], deal["deck"], t, deal.get("exploratory"))
            deals += 1
            folder_ids.setdefault(game, rec["id"])
        elif kind == "mark":
            index.mark(data[0], data[1].get("exploratory"), t)
        elif kind == "end":
            index.end(data[0], data[1].get("result"), data[1].get("moves"), t)
        else:
            shuffle, folder = data
            games = [n[:-6] for n in os.listdir(folder) if n.endswith(".jsonl") and n != "annotations.jsonl"]
            ids = {folder_ids.get(g) for g in games} - {None}
            for sid in ids:
                index.delete(sid, t)
    if os.path.exists(tmp):
        os.replace(tmp, path)
    elif os.path.exists(path):
        os.remove(path)
    return len(index.shuffles), deals


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    games_dir = os.path.join(os.environ.get("LAB_DATA", here), "games")
    catalog_dir = os.environ.get("LAB_CATALOG", os.path.join(here, "catalog"))
    if sys.argv[1:] == ["--rebuild"]:
        shuffles, games = rebuild(games_dir)
        print(f"Rebuilt games/index.jsonl: {shuffles} shuffles from {games} games.")
    elif len(sys.argv) == 3 and sys.argv[1] == "--restore":
        try:
            n = restore_shuffle(games_dir, catalog_dir, sys.argv[2])
        except ValueError as e:
            sys.exit(f"Can't restore {sys.argv[2]}: {e}.")
        print(f"No deleted shuffle {sys.argv[2]}." if n is None else
              f"Restored {sys.argv[2]} ({n} games). Restart ./play to see it in the list.")
    else:
        print(__doc__)
