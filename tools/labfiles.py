"""Shared helpers for the play-lab tools: where files are, reading logs, and describing events.

Standard library only. Nothing here reads the hidden deck order except replay helpers that are
explicitly for finished games (see CLAUDE.md).
"""
import json
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.environ.get("LAB_DATA", ROOT)   # games/ and live/ (server.py --data); the repository by default
GAMES = os.path.join(DATA, "games")
LIVE = os.path.join(DATA, "live")
CATALOG = os.environ.get("LAB_CATALOG", os.path.join(ROOT, "catalog"))
QUESTION = os.path.join(LIVE, "question.json")
ANSWERS = os.path.join(LIVE, "answers.jsonl")
CURRENT = os.path.join(LIVE, "current.json")
REASONS = os.path.join(CATALOG, "reasons.json")
ANNOTATIONS = os.path.join(CATALOG, "annotations.jsonl")

SUITS = {"S": "♠", "H": "♥", "C": "♣", "D": "♦"}


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def read_json(path, default=None):
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
        f.write("\n")
    os.replace(tmp, path)


def append_line(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def read_lines(path):
    out = []
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


def game_path(game_id):
    return os.path.join(GAMES, game_id + ".jsonl")


def current_game():
    """The game being played (or last played), from live/current.json, else the newest log."""
    cur = read_json(CURRENT, {}) or {}
    if cur.get("game") and os.path.exists(game_path(cur["game"])):
        return cur["game"]
    return newest_game()


def newest_game():
    try:
        files = [f for f in os.listdir(GAMES) if f.endswith(".jsonl") and f != "index.jsonl"]
    except OSError:
        return None
    if not files:
        return None
    files.sort(key=lambda f: os.path.getmtime(os.path.join(GAMES, f)))
    return files[-1][:-6]


def all_games():
    try:
        return sorted(f[:-6] for f in os.listdir(GAMES) if f.endswith(".jsonl") and f != "index.jsonl")
    except OSError:
        return []


def standing_actions(events):
    """Moves and turns that were not undone, in order; each gets 'undone': False.
    Also returns every action in order (undone ones marked True)."""
    all_actions, standing = [], []
    for e in events:
        if e.get("type") in ("move", "turn"):
            a = dict(e, undone=False)
            all_actions.append(a)
            standing.append(a)
        elif e.get("type") == "undo":
            for i in range(len(standing) - 1, -1, -1):
                if standing[i].get("n") == e.get("undoes"):
                    standing[i]["undone"] = True
                    del standing[i]
                    break
    return standing, all_actions


def card_text(card_id):
    return card_id[0] + SUITS.get(card_id[1], card_id[1]) if card_id else "--"


def view_text(v):
    """One line for a logged position (visible cards only)."""
    if not v:
        return ""
    cols = []
    for i, c in enumerate(v.get("cols", [])):
        up = " ".join(card_text(x) for x in c.get("up", []))
        cols.append(f"{'abcdefg'[i]}:{'#' * c.get('down', 0)}{up or ('' if c.get('down') else '--')}")
    waste = " ".join(card_text(x) for x in v.get("waste", [])) or "--"
    under = f"(+{v['under']})" if v.get("under") else ""
    home = " ".join(card_text(x) for x in v.get("home", []))
    return f"s{v.get('stock', 0)} w:{waste}{under} | {' | '.join(cols)} | h:{home}"


def plays_text(e):
    """The plays that were available: 'A♠h | 4♥a | s'."""
    return " | ".join(p["text"] for p in e.get("plays") or []) or "(none)"


def decisions(events, include_undone=False):
    """The player's decisions in a game: standing (or all) actions that were not automatic and had
    a real choice (2 or more plays)."""
    standing, all_actions = standing_actions(events)
    chosen = all_actions if include_undone else standing
    return [a for a in chosen if not a.get("auto") and len(a.get("plays") or []) >= 2]
