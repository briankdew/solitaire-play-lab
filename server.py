#!/usr/bin/env python3
"""Play-lab server: serves the game and records what happens while you play.

    python3 server.py [--port 8000] [--host 127.0.0.1]

Standard library only. Besides serving the page, it has a small API used by ui/lab.js:

    GET  /api/status     {"recording": true}
    POST /api/event      {"game": id, "event": {...}}  -> one line in games/<id>.jsonl
    GET  /api/question   the open question from Claude (live/question.json), or {}
    POST /api/answer     {"id": question id, "text": ...} -> live/answers.jsonl and the game log

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

ROOT = os.path.dirname(os.path.abspath(__file__))
GAMES = LIVE = QUESTION = ANSWERS = CURRENT = None  # set by use_data_dir()


def use_data_dir(data):
    """Where games/ and live/ go: the repository by default (--data for tests)."""
    global GAMES, LIVE, QUESTION, ANSWERS, CURRENT
    GAMES = os.path.join(data, "games")
    LIVE = os.path.join(data, "live")
    QUESTION = os.path.join(LIVE, "question.json")
    ANSWERS = os.path.join(LIVE, "answers.jsonl")
    CURRENT = os.path.join(LIVE, "current.json")
    os.makedirs(GAMES, exist_ok=True)
    os.makedirs(LIVE, exist_ok=True)

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
        path = self.path.split("?", 1)[0]
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
        return self.send_json({"error": "not found"}, 404)

    def event(self, data):
        game, event = data.get("game"), data.get("event")
        if not isinstance(game, str) or not GAME_ID.match(game) or not isinstance(event, dict):
            return self.send_json({"error": "bad event"}, 400)
        event.setdefault("t", now())
        file = os.path.join(GAMES, game + ".jsonl")
        with lock:
            append_line(file, event)
            if event.get("type") == "deal":
                write_json(CURRENT, {"game": game, "file": os.path.relpath(file, os.path.dirname(GAMES)), "started": event["t"]})
        return self.send_json({"ok": True})

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
