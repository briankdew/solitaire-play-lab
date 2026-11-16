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


RANKS = "A23456789XJQK"
RED = set("HD")


def _fits_on(card, target):
    """card can go on target in a column: one rank lower, the other colour."""
    return (RANKS.index(card[0]) + 1 == RANKS.index(target[0])) and ((card[1] in RED) != (target[1] in RED))


LETTERS = "abcdefghijklmnopqrstuvwxyz"


def play_fact(view, key):
    """What a play does, from the visible position only, and whether it is useful under the
    player's definition of a new play (ONP / NNP codes): a run moved from one face-up card to another is useful only when the
    card it frees is immediately playable (home, or onto another column); a play home is useful;
    taking a card back off home is not. Returns (fact, useful).
    Facts: 'w' (from the waste), 'from h' (back off home), 'reveals' (turns a face-down card over),
    'empties d' (leaves column d empty), 'frees 8♣: playable' / 'frees 8♣: no play'."""
    if key == "s" or not view:
        return "", False
    card, dest = key[:2], key[2:]
    if view.get("waste") and view["waste"][-1] == card:
        return "w", True
    if card in (view.get("home") or []):
        return "from h", False
    cols = view.get("cols") or []
    for i, c in enumerate(cols):
        up = c.get("up") or []
        if card not in up:
            continue
        k = up.index(card)
        if k == 0:
            return ("reveals", True) if c.get("down") else (f"empties {LETTERS[i]}", True)
        freed = up[k - 1]
        home_ok = freed[0] == "A" or any(h and h[1] == freed[1] and RANKS.index(h[0]) + 1 == RANKS.index(freed[0])
                                         for h in view.get("home") or [])
        col_ok = False
        for j, o in enumerate(cols):
            if j == i or LETTERS[j] == dest:
                continue
            o_up = o.get("up") or []
            if o_up and _fits_on(freed, o_up[-1]):
                col_ok = True
            elif not o_up and not o.get("down") and freed[0] == "K" and not (k - 1 == 0 and not c.get("down")):
                col_ok = True
        ok = home_ok or col_ok
        return f"frees {card_text(freed)}: {'playable' if ok else 'no play'}", ok or dest == "h"
    return "", True


def play_identity(view, key):
    """A play named by its cards, not its columns (a new play: 7♣ onto the 8♦ is the same play wherever
    the 8♦ sits): (card, target), the target being the card it goes on, the top card of its suit's
    home pile ('h' plus that card, or 'h' alone for an ace), or an empty column ('empty d')."""
    if key == "s" or not view:
        return None
    card, dest = key[:2], key[2:]
    if dest == "h":
        top = next((h for h in view.get("home") or [] if h and h[1] == card[1]), None)
        return (card, "h" + (top or ""))
    i = LETTERS.index(dest)
    col = (view.get("cols") or [])[i]
    up = col.get("up") or []
    return (card, up[-1] if up else f"empty {dest}")


def fresh_keys(prev, e):
    """The plays of action event e that are freshly available (a new play, ONP / NNP): not available, by the same
    cards, in the position before the previous action (`prev`, that action's event; None at the
    start of the game). After an Undo, `prev` is the action before the one taken back."""
    view = e.get("view")
    keys = [p["key"] for p in e.get("plays") or [] if p["key"] != "s"]
    if not prev:
        return set(keys)
    before = {play_identity(prev.get("view"), p["key"]) for p in prev.get("plays") or [] if p["key"] != "s"}
    return {k for k in keys if play_identity(view, k) not in before}


def plays_facts_text(e, prev=None):
    """The plays with what each does: '8♣c [frees 9♥: no play] | 9♣e [w] | s', then the new plays:
    freshly available (see fresh_keys) and useful (see play_fact)."""
    view = e.get("view")
    fresh = fresh_keys(prev, e)
    parts, new = [], []
    for p in e.get("plays") or []:
        fact, useful = play_fact(view, p["key"])
        parts.append(p["text"] + (f" [{fact}]" if fact else ""))
        if p["key"] in fresh and useful:
            new.append(p["text"])
    return " | ".join(parts) or "(none)", " ".join(new) or "none (NNP)"


def is_exploratory(events):
    """True if the game is exploratory: the last switch before it ended (deal, mark or end event)."""
    flag = False
    for e in events:
        if e.get("type") in ("deal", "mark", "end") and "exploratory" in e:
            flag = bool(e["exploratory"])
    return flag


def decisions(events, include_undone=False):
    """The player's decisions in a game: standing (or all) actions that were not automatic and had
    a real choice (2 or more plays)."""
    standing, all_actions = standing_actions(events)
    chosen = all_actions if include_undone else standing
    return [a for a in chosen if not a.get("auto") and len(a.get("plays") or []) >= 2]
