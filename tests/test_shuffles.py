"""Shuffle IDs, mirror groups and the shuffle index. Run with: npm test (or python3 -m unittest discover -s tests)."""
import json
import os
import re
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import shuffles as SH  # noqa: E402

DEAL1 = "AS 3H 4H 3S AH 2S 4S 2H".split()
SWAPPED = [c[0] + {"S": "H", "H": "S"}[c[1]] for c in DEAL1]   # the same game with ♠ and ♥ traded
OTHER = "2H AS 4H 3S AH 2S 4S 3H".split()


class ShuffleIds(unittest.TestCase):
    def test_fingerprint_is_12_hex_and_depends_on_setup_and_order(self):
        fp = SH.fingerprint("4223", DEAL1)
        self.assertRegex(fp, r"^[0-9a-f]{12}$")
        self.assertEqual(fp, SH.fingerprint("4223", list(DEAL1)))
        self.assertNotEqual(fp, SH.fingerprint("4224", DEAL1))
        self.assertNotEqual(fp, SH.fingerprint("4223", OTHER))

    def test_id_format(self):
        self.assertEqual(SH.shuffle_id("K473", 1, "7f3a9c21d4e8"), "K473-000001-7f3a9c21d4e8")
        self.assertEqual(SH.shuffle_id("K473", 1234567, "7f3a9c21d4e8"), "K473-1234567-7f3a9c21d4e8")

    def test_mirrors_share_a_group_and_others_do_not(self):
        self.assertEqual(SH.mirror_group("4223", DEAL1), SH.mirror_group("4223", SWAPPED))
        self.assertNotEqual(SH.mirror_group("4223", DEAL1), SH.mirror_group("4223", OTHER))

    def test_suit_relabellings_keep_colours(self):
        self.assertEqual(len(SH.suit_maps(["H", "S"])), 2)
        maps = SH.suit_maps(["C", "D", "H", "S"])
        self.assertEqual(len(maps), 8)
        black = {"S", "C"}
        for m in maps:   # same-colour suits stay together
            self.assertEqual(m["S"] in black, m["C"] in black)


class ShuffleIndex(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "index.jsonl")

    def test_counter_per_setup_and_replays_keep_the_id(self):
        ix = SH.Index(self.path)
        a, first_a = ix.deal("g1", "4223", DEAL1, "t1")
        b, first_b = ix.deal("g2", "4223", OTHER, "t2")
        c, first_c = ix.deal("g3", "4224", DEAL1, "t3")
        again, first_again = ix.deal("g4", "4223", DEAL1, "t4")
        self.assertTrue(re.match(r"^4223-000001-[0-9a-f]{12}$", a["id"]))
        self.assertTrue(b["id"].startswith("4223-000002-"))
        self.assertTrue(c["id"].startswith("4224-000001-"))
        self.assertEqual(again["id"], a["id"])
        self.assertEqual([first_a, first_b, first_c, first_again], [True, True, True, False])
        ix.end("g1", "W", 9, "t5")
        ix.end("g4", "L", 3, "t6")
        # A fresh load from the file gives the same picture.
        ix2 = SH.Index(self.path)
        s = ix2.summary(ix2.get(a["id"]))
        self.assertEqual((s["plays"], s["W"], s["L"], s["last"]), (2, 1, 1, "t4"))
        self.assertEqual(ix2.setups(), {"4223": 2, "4224": 1})
        self.assertEqual(ix2.counters["4223"], 2)

    def test_listing_newest_first_search_and_no_cards(self):
        ix = SH.Index(self.path)
        ix.deal("g1", "4223", DEAL1, "t1")
        ix.deal("g2", "4223", OTHER, "t2")
        ix.deal("g3", "4223", SWAPPED, "t3")
        out = ix.listing("4223")
        self.assertEqual(out["total"], 3)
        self.assertEqual([i["n"] for i in out["items"]], [3, 2, 1])
        self.assertNotIn("deck", json.dumps(out))
        self.assertEqual([i["n"] for i in ix.listing("4223", q="2")["items"]], [2])
        third = out["items"][0]
        self.assertEqual(third["mirror_of"], [out["items"][2]["id"]])   # the swapped deal mirrors deal 1

    def test_rebuild_from_game_logs(self):
        games = os.path.join(self.dir, "games")
        os.makedirs(games)
        for game, deck, t, result in [("a", DEAL1, "2026-01-01T00:00:01", "W"), ("b", OTHER, "2026-01-01T00:00:02", None),
                                      ("c", DEAL1, "2026-01-01T00:00:03", "L")]:
            with open(os.path.join(games, game + ".jsonl"), "w") as f:
                f.write(json.dumps({"type": "deal", "setup": "4223", "deck": deck, "t": t}) + "\n")
                if result:
                    f.write(json.dumps({"type": "end", "result": result, "moves": 1, "t": t}) + "\n")
        self.assertEqual(SH.rebuild(games), (2, 3))
        ix = SH.Index(os.path.join(games, "index.jsonl"))
        first = ix.listing("4223")["items"][-1]
        self.assertEqual((first["n"], first["plays"], first["W"], first["L"]), (1, 2, 1, 1))



def write_game(games_dir, game, deck, t, result=None, exploratory=False, marks=()):
    with open(os.path.join(games_dir, game + ".jsonl"), "w") as f:
        f.write(json.dumps({"type": "deal", "setup": "4223", "deck": deck, "exploratory": exploratory, "t": t}) + "\n")
        for m_t, flag in marks:
            f.write(json.dumps({"type": "mark", "exploratory": flag, "t": m_t}) + "\n")
        if result:
            f.write(json.dumps({"type": "end", "result": result, "moves": 1, "t": t + "z"}) + "\n")


class ExploratoryAndDelete(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.games = os.path.join(self.dir, "games")
        self.catalog = os.path.join(self.dir, "catalog")
        os.makedirs(self.games)
        os.makedirs(self.catalog)
        self.path = os.path.join(self.games, "index.jsonl")

    def test_kinds_are_listed_apart_and_can_switch_until_the_game_ends(self):
        ix = SH.Index(self.path)
        rec, _ = ix.deal("g1", "4223", DEAL1, "t1", exploratory=True)
        ix.deal("g2", "4223", DEAL1, "t2")
        ix.deal("g3", "4223", OTHER, "t3")
        self.assertEqual([i["n"] for i in ix.listing("4223", kind="exploratory")["items"]], [1])
        self.assertEqual([i["n"] for i in ix.listing("4223", kind="method")["items"]], [2, 1])
        self.assertEqual(ix.listing("4223", kind="method")["items"][1]["games"], {"method": 1, "exploratory": 1})
        ix.mark("g3", True, "t4")           # switched mid-game
        ix.end("g3", "W", 5, "t5")
        ix.mark("g3", False, "t6")          # after the end: ignored
        ix2 = SH.Index(self.path)
        self.assertEqual(ix2.setups("exploratory"), {"4223": 2})
        self.assertEqual(ix2.setups("method"), {"4223": 1})
        third = ix2.listing("4223", kind="exploratory")["items"][0]
        self.assertEqual((third["n"], third["plays"], third["W"]), (2, 1, 1))

    def test_delete_moves_the_games_never_reuses_the_counter_and_restores(self):
        write_game(self.games, "g1", DEAL1, "2026-01-01T01", "W")
        write_game(self.games, "g2", OTHER, "2026-01-01T02", "L")
        with open(os.path.join(self.catalog, "annotations.jsonl"), "w") as f:
            f.write(json.dumps({"game": "g1", "n": 1}) + "\n" + json.dumps({"game": "g2", "n": 1}) + "\n")
        SH.rebuild(self.games)
        ix = SH.Index(self.path)
        first = ix.listing("4223")["items"][-1]["id"]
        self.assertEqual(SH.delete_shuffle(ix, self.games, self.catalog, first, "2026-01-01T03"), 1)
        self.assertFalse(os.path.exists(os.path.join(self.games, "g1.jsonl")))
        self.assertTrue(os.path.exists(os.path.join(self.games, "deleted", first, "g1.jsonl")))
        with open(os.path.join(self.catalog, "annotations.jsonl")) as f:
            self.assertEqual([json.loads(x)["game"] for x in f], ["g2"])
        self.assertEqual(SH.Index(self.path).listing("4223")["total"], 1)
        # A rebuild keeps the deleted shuffle's number reserved.
        SH.rebuild(self.games)
        ix = SH.Index(self.path)
        self.assertEqual(ix.counters["4223"], 2)
        # Restoring brings it back under its own ID, annotations included.
        self.assertEqual(SH.restore_shuffle(self.games, self.catalog, first), 1)
        ix = SH.Index(self.path)
        self.assertEqual([i["id"] for i in ix.listing("4223")["items"]][-1], first)
        self.assertEqual(ix.summary(ix.get(first))["W"], 1)
        with open(os.path.join(self.catalog, "annotations.jsonl")) as f:
            self.assertEqual(sorted(json.loads(x)["game"] for x in f), ["g1", "g2"])
        self.assertFalse(os.path.exists(os.path.join(self.games, "deleted", first)))

    def test_cards_dealt_again_after_a_delete_get_a_new_number(self):
        ix = SH.Index(self.path)
        old, _ = ix.deal("g1", "4223", DEAL1, "t1")
        SH.delete_shuffle(ix, self.games, self.catalog, old["id"], "t2")
        new, first = ix.deal("g2", "4223", DEAL1, "t3")
        self.assertTrue(first)
        self.assertTrue(new["id"].startswith("4223-000002-"))
        with self.assertRaises(ValueError):   # restoring the old one would clash with the new one
            SH.restore_shuffle(self.games, self.catalog, old["id"])


if __name__ == "__main__":
    unittest.main()
