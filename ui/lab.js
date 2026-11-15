// Think aloud: records every action of a game, with your notes, through the play-lab server
// (server.py), and shows Claude's questions. Without the server the page plays as usual and the
// panel says it isn't recording.
import { G, S, setupCode } from './shared.js';

const F = window.LabFeatures;
const M = window.LabModel;

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

const QUESTION_POLL_MS = 2500;

let recording = false;
let valuation = { name: 'none', values: {} };
let game = null;      // { id, ended }
let n = 0;            // actions so far in this game (moves and turns of the stock)
let moveNo = 0;       // numbered moves so far (as in the game record)
let done = [];        // the actions not undone, newest last: { n, kind }
let lastAt = 0;       // when the last action (or the deal) happened
let question = null;  // the question showing
let queue = Promise.resolve();

/* ---------- sending ---------- */

function send(event) {
  if (!recording || !game) return;
  const body = JSON.stringify({ game: game.id, event });
  queue = queue.then(() => fetch('/api/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
    .then((r) => { if (!r.ok) throw new Error(r.status); })
    .catch(() => setStatus(false, 'Recording failed: is ./play still running?'));
}

function takeNote() {
  const text = noteEl.value.trim();
  noteEl.value = '';
  return text || undefined;
}

function sinceLast() {
  const now = performance.now();
  const ms = Math.round(now - lastAt);
  lastAt = now;
  return ms;
}

/** The plays in a position, their scores and the model's pick. */
function decision(state) {
  const plays = F.plays(state);
  const { scores, pick } = M.score(plays, valuation);
  return {
    plays: plays.map((p) => ({ key: p.key, text: p.text, factors: p.factors })),
    scores,
    pick,
    model: valuation.name,
  };
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
    view: F.describe(state),
    ...decision(state),
    note: takeNote(),
  });
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
  const d = decision(prev);
  n += 1;
  if (kind === 'move') moveNo += 1;
  done.push({ n, kind });
  const event = {
    type: kind,
    n,
    move_no: kind === 'move' ? moveNo : undefined,
    key,
    text: F.keyText(key),
    token: G.tokenText(token),
    think_ms: sinceLast(),
    view: F.describe(prev),
    ...d,
    matched: d.pick.includes(key),
    choices: d.plays.length,
    note: auto ? undefined : takeNote(),
  };
  if (auto) event.auto = true;
  if (retake) event.retake = true;
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
  if (game) game.ended = false;   // only a win can be undone (End game and Quit can't)
  const target = toMark == null ? done.length - 1 : toMark;
  const note = takeNote();
  sinceLast();
  while (done.length > Math.max(0, target)) {
    const last = done.pop();
    if (last.kind === 'move') moveNo -= 1;
    send({ type: 'undo', undoes: last.n, note: done.length === target ? note : undefined });
  }
}

/** The click-again take-back: the last move (to a foundation) is replaced by a move to a column. */
export function onRetake(prev, next, token) {
  const last = done.pop();
  if (last) {
    if (last.kind === 'move') moveNo -= 1;
    send({ type: 'undo', undoes: last.n, retake: true });
  }
  onAction(prev, next, token, { retake: true });
}

/** The game ended: 'W' (won), 'L' (End game) or 'quit'. */
export function onEnd(result) {
  if (!game || game.ended) return;
  game.ended = true;
  send({
    type: 'end',
    result,
    moves: S.moves,
    record: S.record ? G.recordText(S.state, S.record) : null,
    note: takeNote(),
  });
}

/* ---------- notes and answers ---------- */

function sendNoteNow() {
  const text = takeNote();
  if (!text) return;
  send({ type: 'note', after: done.length ? done[done.length - 1].n : 0, text });
  noteSend.textContent = 'Added';
  setTimeout(() => { noteSend.textContent = 'Add note now'; }, 1200);
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
  if (!question) return;
  qMove.textContent = question.n ? `about action ${question.n}${question.play ? ` (${question.play})` : ''}` : '';
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
  panel.classList.toggle('off', !on);
  statusEl.textContent = message || (on ? (game ? 'Recording' : 'Ready to record') : 'Not recording');
}
function showStatus() { if (recording) setStatus(true); }

async function start() {
  speech(noteMic, noteEl);
  speech(answerMic, answerEl);
  noteSend.addEventListener('click', sendNoteNow);
  answerSend.addEventListener('click', sendAnswer);
  for (const box of [noteEl, answerEl]) {
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); (box === noteEl ? sendNoteNow : sendAnswer)(); }
    });
  }
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const v = await fetch('model/valuation.json', { cache: 'no-store' });
    if (v.ok) valuation = await v.json();
    setStatus(true);
    setInterval(pollQuestion, QUESTION_POLL_MS);
    pollQuestion();
  } catch {
    setStatus(false, 'Not recording: start ./play');
  }
}

start();
