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
        self.assertEqual(L.play_fact(VIEW, "8De"), ("empties d", True))
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


if __name__ == "__main__":
    unittest.main()
