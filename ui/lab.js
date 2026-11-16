// Think aloud: records every action of a game, with your notes, through the play-lab server
// (server.py), and shows Claude's questions. Without the server the page plays as usual and the
// panel says it isn't recording.
import { G, S, setupCode } from './shared.js';
import { setReplayAvailable } from './replay.js';
import { markAsked } from './record.js';

const P = window.LabPlays;

const el = (id) => document.getElementById(id);
const panel = el('lab');
const statusEl = el('labStatus');
const noteEl = el('labNote');
const noteMic = el('labNoteMic');
const noteSend = el('labNoteSend');
const qBox = el('labQuestion');
const qMove = el('labQMove');
const qText = el('labQText');
const answerEl = el('labAnswer');
const answerMic = el('labAnswerMic');
const answerSend = el('labAnswerSend');
const shuffleEl = el('labShuffle');
const exploreChk = el('labExplore');
const codeSel = el('labCode');
const codeDefEl = el('labCodeDef');
const EXPLORE_KEY = 'solitaire-play-lab.exploratory';

const QUESTION_POLL_MS = 2500;

let recording = false;
let game = null;      // { id, ended }
let n = 0;            // actions so far in this game (moves and turns of the stock)
let moveNo = 0;       // numbered moves so far (as in the game record)
let done = [];        // the actions not undone, newest last: { n, kind, note }
let lastAt = 0;       // when the last action (or the deal) happened
let question = null;  // the question showing
let queue = Promise.resolve();

/* ---------- sending ---------- */

function send(event, onReply) {
  if (!recording || !game) return;
  const body = JSON.stringify({ game: game.id, event });
  queue = queue.then(() => fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((reply) => { if (onReply) onReply(reply); })
    .catch(() => setStatus(false, 'Recording failed: is ./play still running?'));
}

/** The shuffle being played, under the Think aloud title. */
let shuffleId = null;   // the shuffle being played, from the server
function showShuffle(reply) {
  shuffleId = reply && reply.shuffle ? reply.shuffle : null;
  if (!reply || !reply.shuffle) { shuffleEl.hidden = true; return; }
  const times = reply.first_deal ? 'new' : `game ${reply.plays} of this shuffle`;
  const mirror = reply.mirror_of && reply.mirror_of.length ? ` · mirror of ${reply.mirror_of[0]}` : '';
  shuffleEl.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = reply.shuffle;
  shuffleEl.append('Shuffle ', b, ` · ${times}${mirror}`);
  shuffleEl.hidden = false;
}

function takeNote() {
  const text = noteEl.value.trim();
  noteEl.value = '';
  codeDefEl.hidden = true;
  return text || undefined;
}

function sinceLast() {
  const now = performance.now();
  const ms = Math.round(now - lastAt);
  lastAt = now;
  return ms;
}

/** The plays available in a position, as keys and text (no judgment of them). */
function playsOf(state) {
  return P.plays(state).map((p) => ({ key: p.key, text: p.text }));
}

const pad = (x) => String(x).padStart(2, '0');
function newGameId() {
  const d = new Date();
  const tag = Array.from(crypto.getRandomValues(new Uint8Array(2)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${setupCode()}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${tag}`;
}

/* ---------- hooks called by actions.js ---------- */

/** A game was dealt (Deal, Restart deal, Same deal or New deal). `deck` is the shuffle, top card first. */
export function onDeal(state, deck) {
  if (game && !game.ended) send({ type: 'end', result: 'abandoned', moves: S.moves });
  game = { id: newGameId(), ended: false };
  panel.dataset.game = game.id;
  n = 0;
  moveNo = 0;
  done = [];
  S.undoneSeq = [];
  lastAt = performance.now();
  send({
    type: 'deal',
    v: 1,
    setup: setupCode(),
    settings: S.settings,
    // The hidden order of the deck, top card first: for replaying the game afterwards.
    // Not to be read while the game is being played (see CLAUDE.md).
    deck: deck ? deck.map((c) => c.id) : null,
    deal: (S.record || []).map((t) => G.tokenText(t)).join(' '),
    view: P.describe(state),
    plays: playsOf(state),
    exploratory: exploreChk.checked,
    note: takeNote(),
  }, showShuffle);
  shuffleEl.hidden = true;
  codeDefEl.hidden = true;
  loadCodes();
  showStatus();
}

/**
 * An action: a card played (`token.type` 'move') or a turn of the stock ('turn'). `prev` is the
 * position the player saw, `next` the position after. `auto` marks the automatic finish's moves.
 */
export function onAction(prev, next, token, { auto = false, retake = false } = {}) {
  if (!game || !token) return;
  const kind = token.type === 'move' ? 'move' : 'turn';
  const key = kind === 'move' ? token.card + token.to : 's';
  const plays = playsOf(prev);
  n += 1;
  if (kind === 'move') moveNo += 1;
  const entry = { n, kind };
  done.push(entry);
  token.seq = n;   // the Game Recorder shows it beside the line
  const event = {
    type: kind,
    n,
    move_no: kind === 'move' ? moveNo : undefined,
    key,
    text: P.keyText(key),
    token: G.tokenText(token),
    think_ms: sinceLast(),
    view: P.describe(prev),
    plays,
    choices: plays.length,
    note: auto ? undefined : takeNote(),
  };
  if (auto) event.auto = true;
  if (retake) event.retake = true;
  entry.note = event.note;
  if (kind === 'turn') event.turned = token.cards;
  if (kind === 'move' && token.from !== 'w' && token.from !== 'h') {
    // A face-down card turned over by the move: now known to the player.
    const i = G.COLUMN_LETTERS.indexOf(token.from);
    const before = prev.tableau[i];
    const after = next.tableau[i];
    if (after.length && before.length > after.length && !before[after.length - 1].faceUp) {
      event.revealed = after[after.length - 1].id;
    }
  }
  send(event);
}

/** A mark for Undo: how many actions stand now (kept with each Undo step in S.history). */
export function mark() {
  return done.length;
}

/** Undo went back to `toMark` (see mark()): every action after it is taken back, newest first. */
export function onUndo(toMark) {
  if (game) game.ended = false;   // only a win can be undone (End game and Forfeit can't)
  const target = toMark == null ? done.length - 1 : toMark;
  sinceLast();
  let back;   // the note of the play taken back (the oldest, if several)
  while (done.length > Math.max(0, target)) {
    const last = done.pop();
    if (last.kind === 'move') moveNo -= 1;
    S.undoneSeq.push(last.n);
    back = last.note;
    send({ type: 'undo', undoes: last.n });
  }
  // A note being typed stays in the box for the play made instead; with none, the undone play's
  // note goes back in the box so that play picks it up (or it can be edited).
  if (back && !noteEl.value.trim()) noteEl.value = back;
}

/** The click-again take-back: the last move (to a foundation) is replaced by a move to a column. */
export function onRetake(prev, next, token) {
  const last = done.pop();
  if (last) {
    if (last.kind === 'move') moveNo -= 1;
    S.undoneSeq.push(last.n);
    send({ type: 'undo', undoes: last.n, retake: true });
    if (last.note && !noteEl.value.trim()) noteEl.value = last.note;   // the note goes with the play made instead
  }
  onAction(prev, next, token, { retake: true });
}

/** The game ended: 'W' (won), 'L' (End game) or 'quit' (Forfeit). */
export function onEnd(result) {
  if (!game || game.ended) return;
  game.ended = true;
  send({
    type: 'end',
    result,
    moves: S.moves,
    record: S.record ? G.recordText(S.state, S.record) : null,
    exploratory: exploreChk.checked,
    note: takeNote(),
  });
}

/** The shuffle of the game in play (it can't be deleted while it's being played), or null. */
export function shuffleInPlay() {
  return game && !game.ended ? shuffleId : null;
}

/* ---------- exploratory games ---------- */

/** Exploratory: a game kept out of the model. The switch applies to the game in play (until it
 * ends) and to the games dealt after it, until it is switched off. */
function showExploratory() {
  panel.classList.toggle('exploring', exploreChk.checked);
}
function onExploreChange() {
  try { localStorage.setItem(EXPLORE_KEY, exploreChk.checked ? 'on' : 'off'); } catch { /* ignore */ }
  showExploratory();
  if (game && !game.ended) send({ type: 'mark', exploratory: exploreChk.checked, after: done.length ? done[done.length - 1].n : 0 });
}

/* ---------- reason codes ---------- */

/** Put text into a box at its cursor (or the end), with a space on either side where needed. */
export function insertAt(box, text, spaced = true) {
  const v = box.value;
  const a = box.selectionStart ?? v.length;
  const b = box.selectionEnd ?? v.length;
  const before = spaced && a > 0 && !/\s/.test(v[a - 1]) ? ' ' : '';
  const after = spaced && b < v.length && !/\s/.test(v[b]) ? ' ' : '';
  box.value = v.slice(0, a) + before + text + after + v.slice(b);
  const at = a + before.length + text.length;
  box.setSelectionRange(at, at);
}

// The menu: the NNP and ONP codes first, then the other adopted codes from catalog/reasons.json, most used first
// (refreshed at each deal). Hovering an entry shows its definition; picking one shows it below.
const PINNED = ['NNP', 'ONP'];
const SHORTHAND = [   // used only when the server's list can't be read
  { code: 'NNP', name: 'No new play', definition: 'No new play is available, so I draw.' },
  { code: 'ONP', name: 'Only new play', definition: 'Multiple plays may be available, but the play I made was the only new play.' },
];
let codeDefs = {};
function codeOption(c, label) {
  const o = document.createElement('option');
  o.value = c.code;
  o.textContent = label;
  o.title = c.definition;
  return o;
}
async function loadCodes() {
  let items = [];
  try {
    const r = await fetch('/api/codes', { cache: 'no-store' });
    if (r.ok) items = (await r.json()).items || [];
  } catch { /* no server: shorthand only */ }
  codeDefs = {};
  const head = codeSel.options[0];
  codeSel.replaceChildren(head);
  const pinned = PINNED.map((code) => items.find((c) => c.code === code) || SHORTHAND.find((c) => c.code === code));
  for (const c of pinned) { codeDefs[c.code] = c; codeSel.append(codeOption(c, `${c.code} · ${c.name}`)); }
  const rest = items.filter((c) => !PINNED.includes(c.code));
  if (rest.length) {
    const g = document.createElement('optgroup');
    g.label = 'Codes, most used first';
    for (const c of rest) { codeDefs[c.code] = c; g.append(codeOption(c, `${c.code} · ${c.name}`)); }
    codeSel.append(g);
  }
  codeSel.value = '';
}
function pickCode() {
  const c = codeDefs[codeSel.value];
  codeSel.value = '';
  if (!c) return;
  insertAt(noteEl, c.code);
  codeDefEl.textContent = `${c.code}: ${c.definition}`;
  codeDefEl.hidden = false;
  noteEl.focus();
}

/* ---------- notes and answers ---------- */

function sendNoteNow() {
  const text = takeNote();
  if (!text) return;
  send({ type: 'note', after: done.length ? done[done.length - 1].n : 0, text });
  noteSend.textContent = 'Added';
  setTimeout(() => { noteSend.textContent = 'Add now'; }, 1200);
}

async function sendAnswer() {
  const text = answerEl.value.trim();
  if (!text || !question) return;
  try {
    const r = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: question.id, text }) });
    if (!r.ok) throw new Error(r.status);
    answerEl.value = '';
    showQuestion(null);
  } catch {
    setStatus(false, 'Could not send the answer: is ./play still running?');
  }
}

/* ---------- Claude's questions ---------- */

function showQuestion(q) {
  question = q && q.id ? q : null;
  qBox.hidden = !question;
  markAsked(question && question.game === (game && game.id) ? question.n : null);
  if (!question) return;
  // Which position: the line number in the Game Recorder (highlighted there) and the play made from it.
  const line = question.n != null ? String(question.n).padStart(3, '0') : '';
  const before = !question.play ? '' : question.play === 's' ? ', before your draw' : `, before you played ${question.play}`;
  qMove.textContent = line ? `about #${line}${before}` : '';
  qText.textContent = question.text;
}

async function pollQuestion() {
  try {
    const r = await fetch('/api/question', { cache: 'no-store' });
    const q = r.ok ? await r.json() : {};
    if ((q.id || null) !== (question ? question.id : null)) showQuestion(q);
    if (!recording) setStatus(true);
  } catch {
    setStatus(false, 'Not recording: start ./play');
  }
}

/* ---------- speech ---------- */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/** A Speak button that dictates into a text box (Chrome's speech recognition). */
function speech(button, box) {
  if (!Recognition) { button.hidden = true; return; }
  let rec = null;
  let base = '';
  const stop = () => { if (rec) rec.stop(); };
  button.addEventListener('click', () => {
    if (rec) return stop();
    rec = new Recognition();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    base = box.value ? box.value.replace(/\s*$/, ' ') : '';
    rec.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      box.value = (base + finalText + interim).replace(/^\s+/, '');
    };
    rec.onend = () => { rec = null; button.classList.remove('on'); button.textContent = 'Speak'; };
    rec.onerror = (e) => { if (e.error === 'not-allowed') button.hidden = true; };
    rec.start();
    button.classList.add('on');
    button.textContent = 'Stop';
    box.focus({ preventScroll: true });
  });
}

/* ---------- status ---------- */

function setStatus(on, message) {
  recording = on;
  setReplayAvailable(on);
  panel.classList.toggle('off', !on);
  statusEl.textContent = message || (on ? (game ? 'Recording' : 'Ready to record') : 'Not recording');
}
function showStatus() { if (recording) setStatus(true); }

async function start() {
  try { exploreChk.checked = localStorage.getItem(EXPLORE_KEY) === 'on'; } catch { /* ignore */ }
  showExploratory();
  exploreChk.addEventListener('change', onExploreChange);
  speech(noteMic, noteEl);
  speech(answerMic, answerEl);
  noteSend.addEventListener('click', sendNoteNow);
  codeSel.addEventListener('change', pickCode);
  loadCodes();
  // Suit buttons: add the suit at the cursor of their box. Pressing one doesn't take the focus
  // (or the cursor) away from the box.
  for (const group of document.querySelectorAll('.lab-suits')) {
    const box = el(group.dataset.for);
    for (const b of group.querySelectorAll('button')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { insertAt(box, b.dataset.suit, false); box.focus(); });
    }
  }
  answerSend.addEventListener('click', sendAnswer);
  for (const box of [noteEl, answerEl]) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (box === noteEl ? sendNoteNow : sendAnswer)(); }
    });
  }
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    setStatus(true);
    setInterval(pollQuestion, QUESTION_POLL_MS);
    pollQuestion();
  } catch {
    setStatus(false, 'Not recording: start ./play');
  }
}

start();
