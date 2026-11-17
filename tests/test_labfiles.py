"""What the watcher says a play does (visible cards only). Run with: npm test."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools"))
import labfiles as L  # noqa: E402

VIEW = {"stock": 3, "waste": ["5D", "6C", "4S"], "under": 0, "home": ["AD", None],
        "cols": [{"down": 0, "up": ["KD"]}, {"down": 1, "up": ["4D", "3S"]}, {"down": 0, "up": ["9D", "8S"]},
                 {"down": 0, "up": ["8D"]}, {"down": 3, "up": ["XH", "9C"]}, {"down": 5, "up": ["XC", "9H", "8C", "7D", "6S", "5H"]}]}


class PlayFacts(unittest.TestCase):
    def test_waste_reveal_empty(self):
        self.assertEqual(L.play_fact(VIEW, "4Sf"), ("w", True))
        self.assertEqual(L.play_fact(VIEW, "4Db"), ("reveals", True))
        self.assertEqual(L.play_fact(VIEW, "8De"), ("empties d: no king", False))   # keep_options: no king ready
        ace_alone = dict(VIEW, cols=VIEW["cols"][:3] + [{"down": 0, "up": ["AS"]}] + VIEW["cols"][4:])
        self.assertEqual(L.play_fact(ace_alone, "ASh"), ("empties d", True))   # home is always useful
        with_king = dict(VIEW, waste=["5D", "6C", "KH"])
        self.assertEqual(L.play_fact(with_king, "8De"), ("empties d", True))
        self.assertEqual(L.play_fact(VIEW, "s"), ("", False))

    def test_a_run_moved_between_matching_cards_is_new_only_if_the_freed_card_can_play(self):
        self.assertEqual(L.play_fact(VIEW, "8Cc"), ("frees 9♥: no play", False))
        view = dict(VIEW, cols=VIEW["cols"][:4] + [{"down": 3, "up": ["XS"]}] + VIEW["cols"][5:])
        self.assertEqual(L.play_fact(view, "8Cc"), ("frees 9♥: playable", True))   # 9♥ onto X♠
        home = dict(VIEW, cols=VIEW["cols"][:5] + [{"down": 5, "up": ["QH", "AS"]}])
        self.assertEqual(L.play_fact(home, "ASh"), ("frees Q♥: no play", True))   # a play home is always new

    def test_facts_text_lists_the_new_plays(self):
        e = {"view": VIEW, "plays": [{"key": "8Cc", "text": "8♣c"}, {"key": "s", "text": "s"}]}
        self.assertEqual(L.plays_facts_text(e), ("8♣c [frees 9♥: no play] | s", "none (NNP)"))


class Freshness(unittest.TestCase):
    """new_play: a play is new only when freshly available, judged by its cards, not its columns."""
    def view(self, cols, waste=("5D", "6C", "XS"), home=("AD", None)):
        return {"stock": 3, "waste": list(waste), "under": 0, "home": list(home),
                "cols": [{"down": d, "up": list(u)} for d, u in cols]}

    def test_a_play_still_available_by_the_same_cards_is_not_new(self):
        before = {"view": self.view([(0, ["9D", "8S"]), (2, ["8D"]), (1, ["7C"])]),
                  "plays": [{"key": "7Cb", "text": "7♣b"}, {"key": "s", "text": "s"}]}
        # The 8♦ moved from b to a; 7♣ onto the 8♦ is the same play.
        after = {"view": self.view([(0, ["9S", "8D"]), (2, ["4H"]), (1, ["7C"])]),
                 "plays": [{"key": "7Ca", "text": "7♣a"}, {"key": "s", "text": "s"}]}
        self.assertEqual(L.fresh_keys(before, after), set())
        self.assertEqual(L.plays_facts_text(after, before)[1], "none (NNP)")

    def test_a_newly_available_card_or_target_or_waste_card_makes_it_new(self):
        before = {"view": self.view([(0, ["9D"]), (2, ["4H"])]), "plays": [{"key": "s", "text": "s"}]}
        after = {"view": self.view([(0, ["9D"]), (2, ["8S"])], waste=("5D", "6C", "4S")),
                 "plays": [{"key": "8Sa", "text": "8♠a"}, {"key": "s", "text": "s"}]}
        self.assertEqual(L.fresh_keys(before, after), {"8Sa"})
        self.assertEqual(L.fresh_keys(None, after), {"8Sa"})   # the first play of a game: all are new

    def test_a_king_to_an_empty_column_is_named_by_the_column(self):
        v = self.view([(0, []), (1, ["KD"])])
        self.assertEqual(L.play_identity(v, "KDa"), ("KD", "empty a"))
        self.assertEqual(L.play_identity(v, "2Dh"), ("2D", "hAD"))


if __name__ == "__main__":
    unittest.main()
