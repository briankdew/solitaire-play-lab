#!/usr/bin/env python3
"""Play-lab server: serves the game and records what happens while you play.

    python3 server.py [--port 8000] [--host 127.0.0.1]

Standard library only. Besides serving the page, it has a small API used by ui/lab.js:

    GET  /api/status     {"recording": true}
    POST /api/event      {"game": id, "event": {...}}  -> one line in games/<id>.jsonl
    GET  /api/question   the open question from Claude (live/question.json), or {}
    POST /api/answer     {"id": question id, "text": ...} -> live/answers.jsonl and the game log
    GET  /api/setups     ?kind=method|exploratory: {setup: number of shuffles with games of that kind}
    GET  /api/shuffles   ?setup=K473&kind=method&q=&offset=0&limit=50: played shuffles, newest first (no cards)
    GET  /api/shuffle    ?id=K473-000001-7f3a9c21d4e8: one shuffle with its deck order, to replay it
    GET  /api/deleted    deleted shuffles (games/deleted/), newest first
    POST /api/delete     {"id": shuffle id}: move its games to games/deleted/<id>/
    POST /api/restore    {"id": shuffle id}: undo a delete

A deal event gets its shuffle's ID (see shuffles.py) before it is written, and the reply carries it.

Claude writes questions with tools/ask.py and reads the logs with tools/watch.py.
"""
import argparse
import json
import os
import re
import sys
import threading
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import shuffles

ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.environ.get("LAB_CATALOG", os.path.join(ROOT, "catalog"))
GAMES = LIVE = QUESTION = ANSWERS = CURRENT = INDEX = None  # set by use_data_dir()


def use_data_dir(data):
    """Where games/ and live/ go: the repository by default (--data for tests)."""
    global GAMES, LIVE, QUESTION, ANSWERS, CURRENT, INDEX
    GAMES = os.path.join(data, "games")
    LIVE = os.path.join(data, "live")
    QUESTION = os.path.join(LIVE, "question.json")
    ANSWERS = os.path.join(LIVE, "answers.jsonl")
    CURRENT = os.path.join(LIVE, "current.json")
    os.makedirs(GAMES, exist_ok=True)
    os.makedirs(LIVE, exist_ok=True)
    index_path = os.path.join(GAMES, "index.jsonl")
    has_games = any(f.endswith(".jsonl") and f != "index.jsonl" for f in os.listdir(GAMES))
    if has_games and not os.path.exists(index_path):
        shuffles.rebuild(GAMES)
    INDEX = shuffles.Index(index_path)

GAME_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")
MAX_BODY = 1_000_000
lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def append_line(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def deleted_list():
    """Deleted shuffles, newest first: {id, games, t}."""
    out = []
    folder = os.path.join(GAMES, "deleted")
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            info = read_json(os.path.join(folder, name, "deleted.json"), None)
            if info:
                out.append({"id": info.get("shuffle", name), "games": len(info.get("games", [])), "t": info.get("t")})
    out.sort(key=lambda d: d["t"] or "", reverse=True)
    return {"total": len(out), "items": out}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_request(self, code="-", size="-"):  # keep the terminal quiet; failed requests still show
        try:
            failed = int(code) >= 400
        except (TypeError, ValueError):
            failed = False
        if failed:
            super().log_request(code, size)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise ValueError("bad length")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self):
        url = urlsplit(self.path)
        path = url.path
        args = {k: v[0] for k, v in parse_qs(url.query).items()}
        kind = args.get("kind") if args.get("kind") in shuffles.KINDS else None
        if path == "/api/setups":
            with lock:
                return self.send_json(INDEX.setups(kind))
        if path == "/api/shuffles":
            try:
                offset, limit = max(0, int(args.get("offset", 0))), min(500, max(1, int(args.get("limit", 50))))
            except ValueError:
                return self.send_json({"error": "bad offset or limit"}, 400)
            with lock:
                return self.send_json(INDEX.listing(args.get("setup"), args.get("q", ""), offset, limit, kind))
        if path == "/api/shuffle":
            with lock:
                rec = INDEX.get(args.get("id", ""))
                if not rec:
                    return self.send_json({"error": "no such shuffle"}, 404)
                return self.send_json({**INDEX.summary(rec), "deck": rec["deck"]})
        if path == "/api/deleted":
            with lock:
                return self.send_json(deleted_list())
        if path == "/api/status":
            return self.send_json({"recording": True})
        if path == "/api/question":
            q = read_json(QUESTION, {})
            return self.send_json(q if q and not q.get("answered") and not q.get("withdrawn") else {})
        top = path.lstrip("/").split("/", 1)[0]
        if top in ("games", "live", "catalog", "tools", ".git", ".claude"):
            return self.send_error(404)
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        # Only pages served from this server may write (no cross-site posts).
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_json({"error": "json only"}, 415)
        try:
            data = self.read_body()
        except (ValueError, UnicodeDecodeError):
            return self.send_json({"error": "bad body"}, 400)
        if path == "/api/event":
            return self.event(data)
        if path == "/api/answer":
            return self.answer(data)
        if path in ("/api/delete", "/api/restore"):
            return self.delete_or_restore(path, data.get("id"))
        return self.send_json({"error": "not found"}, 404)

    def delete_or_restore(self, path, shuffle):
        global INDEX
        if not isinstance(shuffle, str) or not GAME_ID.match(shuffle):
            return self.send_json({"error": "bad id"}, 400)
        with lock:
            if path == "/api/delete":
                n = shuffles.delete_shuffle(INDEX, GAMES, CATALOG, shuffle, now())
                if n is None:
                    return self.send_json({"error": "no such shuffle"}, 404)
                return self.send_json({"ok": True, "games": n})
            try:
                n = shuffles.restore_shuffle(GAMES, CATALOG, shuffle)
            except ValueError as e:
                return self.send_json({"error": str(e)}, 409)
            if n is None:
                return self.send_json({"error": "no such deleted shuffle"}, 404)
            INDEX = shuffles.Index(os.path.join(GAMES, "index.jsonl"))
            return self.send_json({"ok": True, "games": n})

    def event(self, data):
        game, event = data.get("game"), data.get("event")
        if not isinstance(game, str) or not GAME_ID.match(game) or game == "index" or not isinstance(event, dict):
            return self.send_json({"error": "bad event"}, 400)
        event.setdefault("t", now())
        file = os.path.join(GAMES, game + ".jsonl")
        reply = {"ok": True}
        with lock:
            if event.get("type") != "deal" and not os.path.exists(file):
                return self.send_json({"ok": True, "dropped": "no such game (deleted?)"})
            deck, setup = event.get("deck"), event.get("setup")
            if event.get("type") == "deal" and isinstance(deck, list) and isinstance(setup, str):
                rec, first = INDEX.deal(game, setup, deck, event["t"], event.get("exploratory"))
                event["shuffle"] = rec["id"]
                event["mirror"] = rec["mirror"]
                event["first_deal"] = first
                reply.update({"shuffle": rec["id"], "first_deal": first, "plays": INDEX.stats(rec)["plays"],
                              "mirror_of": INDEX.mirror_of(rec)})
            append_line(file, event)
            if event.get("type") == "deal":
                write_json(CURRENT, {"game": game, "file": os.path.relpath(file, os.path.dirname(GAMES)), "started": event["t"]})
            if event.get("type") == "mark":
                INDEX.mark(game, event.get("exploratory"), event["t"])
            if event.get("type") == "end":
                if "exploratory" in event:
                    INDEX.mark(game, event.get("exploratory"), event["t"])
                INDEX.end(game, event.get("result"), event.get("moves"), event["t"])
        return self.send_json(reply)

    def answer(self, data):
        text = data.get("text")
        if not isinstance(text, str) or not text.strip():
            return self.send_json({"error": "empty answer"}, 400)
        with lock:
            q = read_json(QUESTION, {})
            line = {"t": now(), "question_id": data.get("id") or q.get("id"), "question": q.get("text"),
                    "game": q.get("game"), "n": q.get("n"), "text": text.strip(), "via": "panel"}
            append_line(ANSWERS, line)
            game = q.get("game")
            if game and GAME_ID.match(game):
                append_line(os.path.join(GAMES, game + ".jsonl"), {"type": "answer", **line})
            if q and (not data.get("id") or data.get("id") == q.get("id")):
                q["answered"] = line["t"]
                write_json(QUESTION, q)
        return self.send_json({"ok": True})


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    p.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
    p.add_argument("--data", default=ROOT, help="folder for games/ and live/ (default: this repository)")
    args = p.parse_args()
    use_data_dir(os.path.abspath(args.data))
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Play lab: open http://localhost:{args.port} in Chrome  (Ctrl+C stops)", flush=True)
    print(f"Recording to {GAMES}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()
