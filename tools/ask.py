#!/usr/bin/env python3
"""Claude's question channel: show a question in the game's Think aloud panel, or record an answer.

    python3 tools/ask.py --n 5 --play "A♥h" "Why A♥h before 3♠h?"   # ask about action 5
    python3 tools/ask.py --status                                    # the open question, if any
    python3 tools/ask.py --answer "Because ..."                      # an answer given in the terminal
    python3 tools/ask.py --clear                                     # withdraw the open question
    python3 tools/ask.py --review --game ID --n 51 --play s "Why draw here?"   # /review: shows in Replay
    python3 tools/ask.py --wait                                      # wait for the answer, then print it

A --review question shows in the Replay of that finished game (Played shuffle -> Replay), which jumps
to the action; the play page ignores it. --wait (run in the background) ends when the question is
answered or withdrawn.

One question at a time: asking while one is open fails unless --replace is given.
"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import labfiles as L  # noqa: E402


def open_question():
    q = L.read_json(L.QUESTION, {}) or {}
    return q if q.get("id") and not q.get("answered") and not q.get("withdrawn") else None


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("text", nargs="?", help="the question (keep it under 15 words)")
    p.add_argument("--n", type=int, help="the action it is about (the # in watch.py)")
    p.add_argument("--play", help='the play, e.g. "A♥h"')
    p.add_argument("--game", help="game id (default: the current game)")
    p.add_argument("--replace", action="store_true", help="replace an open question")
    p.add_argument("--status", action="store_true")
    p.add_argument("--answer", help="record an answer given in the terminal")
    p.add_argument("--clear", action="store_true")
    p.add_argument("--review", action="store_true", help="a /review question, shown in the game's Replay")
    p.add_argument("--wait", action="store_true", help="wait until the open question is answered or withdrawn")
    a = p.parse_args()

    q = open_question()
    if a.wait:
        if not q:
            sys.exit("No open question.")
        while True:
            time.sleep(1)
            cur = L.read_json(L.QUESTION, {}) or {}
            if cur.get("id") != q["id"] or cur.get("withdrawn"):
                print("Withdrawn or replaced.")
                return
            if cur.get("answered"):
                ans = [x for x in L.read_lines(L.ANSWERS) if x.get("question_id") == q["id"]]
                print(f"ANSWER (#{q.get('n')}, via {ans[-1].get('via') if ans else '?'}): {ans[-1]['text'] if ans else ''}")
                return
    if a.status:
        print(f"Open: {q['id']} (#{q.get('n')}): {q['text']}" if q else "No open question.")
        return
    if a.clear:
        if q:
            q["withdrawn"] = L.now()
            L.write_json(L.QUESTION, q)
        print("Withdrawn." if q else "No open question.")
        return
    if a.answer:
        q = q or (L.read_json(L.QUESTION, {}) or {})
        line = {"t": L.now(), "question_id": q.get("id"), "question": q.get("text"), "game": q.get("game"),
                "n": q.get("n"), "text": a.answer.strip(), "via": "terminal"}
        L.append_line(L.ANSWERS, line)
        if q.get("game"):
            L.append_line(L.game_path(q["game"]), {"type": "answer", **line})
        if q.get("id"):
            q["answered"] = line["t"]
            L.write_json(L.QUESTION, q)
        print("Answer recorded.")
        return
    if not a.text:
        p.error("give the question text")
    if q and not a.replace:
        sys.exit(f"A question is already open ({q['id']}: {q['text']}). Use --replace or --clear.")
    words = len(a.text.split())
    game = a.game or L.current_game()
    q = {"id": f"q{int(time.time())}", "game": game, "n": a.n, "play": a.play, "text": a.text.strip(), "asked": L.now()}
    if a.review:
        q["review"] = True
    L.write_json(L.QUESTION, q)
    print(f"Asked {q['id']}" + (f" ({words} words: keep it under 15)" if words >= 15 else "")
          + (f" in Replay (Played shuffle -> Replay, or /?replay={game})" if a.review else ""))


if __name__ == "__main__":
    main()
