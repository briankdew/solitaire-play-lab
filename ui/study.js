// Replay (index.html?replay=<game id>, opened from Played shuffle): a finished game, one action at a
// time, read-only, "like replaying a chess match". Each step shows the table as the player saw it
// before an action, and the action taken with the player's note, Claude's questions and the
// player's answers, and the reason codes it was given. Undone actions are skipped (in the play lab an
// Undo corrects a mistake). The plays that were available are not shown: what the player saw, as
// they saw it. Nothing is recorded.
import { G, S, say } from './shared.js';
import { render } from './table.js';
import { dealFromLog } from './actions.js';
import { syncSettingsUI } from './settings.js';
import { speech } from './lab.js';

const P = window.LabPlays;
const SPEEDS = [['Slow', 2000], ['Normal', 1000], ['Fast', 400], ['Very fast', 120]];
const CODES_URL = '/api/codes';
const QUESTION_POLL_MS = 1500;

let steps = [];     // { state, record, action (null on the last step), notes: [text], answers: [{question, text}] }
let cur = 0;
let timer = null;
let names = {};     // code -> name, for the chips' tooltips
let codes = {};     // action n -> [codes]
let ui = null;
let question = null;   // the open /review question about this game ({ id, n, text }), or null
let game = null;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function btn(text, title, onClick, cls = 'btn small') {
  const b = h('button', cls, text);
  b.type = 'button';
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  b.addEventListener('click', onClick);
  return b;
}
const secs = (ms) => `${((ms || 0) / 1000).toFixed(1)}s`;
const actionText = (a) => (a.type === 'turn' ? 'draw (s)' : a.text);

/** Rebuild the game from its deal: one step per standing action, then the final table. */
function buildSteps(events) {
  let state = dealFromLog(events[0]);
  syncSettingsUI();   // the setup line over the table (it saves nothing)
  const record = G.dealTokens(state);
  const actions = P.actions(events).standing;   // an Undo corrected a mistake: the undone action is skipped
  const answers = {};
  for (const e of events) if (e.type === 'answer') (answers[e.n] = answers[e.n] || []).push({ question: e.question, text: e.text });
  // A note added between actions ("Add now") goes with the next action.
  const between = events.filter((e) => e.type === 'note');
  const out = [];
  let prevN = 0;
  for (const a of actions) {
    const r = P.apply(state, a.key);
    if (!r) return null;
    const { state: next, token } = r;
    const notes = between.filter((e) => e.after >= prevN && e.after < a.n).map((e) => e.text);
    prevN = a.n;
    if (a.note) notes.push(a.note);
    out.push({ state, record: record.slice(), action: a, notes, answers: answers[a.n] || [] });
    record.push(token);
    state = next;
  }
  const end = events.filter((e) => e.type === 'end').pop();
  if (end && (end.result === 'W' || end.result === 'L')) record.push(G.resultToken(record, end.result === 'W'));
  out.push({ state, record: record.slice(), action: null, notes: [], answers: [], end });
  return out;
}

/* ---------- the panel ---------- */

function buildPanel(game, deal) {
  const left = document.querySelector('.side-left');
  const box = h('section', 'study');
  box.id = 'study';
  box.setAttribute('aria-label', 'Replay');
  const title = h('h2', 'lab-title');
  title.append(h('span', null, 'Replay'), h('span', 'lab-status', deal.shuffle || game));
  const sub = h('p', 'study-game', `Game ${game}`);
  const bar = h('div', 'study-bar');
  const first = btn('⏮', 'Back to the deal', () => { stop(); go(0); });
  const back = btn('◀', 'Step back', () => { stop(); go(cur - 1); });
  const play = btn('Play', 'Play', toggle, 'btn small study-play');
  const fwd = btn('▶', 'Step forward', () => { stop(); go(cur + 1); });
  const last = btn('⏭', 'Jump to the end', () => { stop(); go(steps.length - 1); });
  const speed = h('select', 'study-speed');
  speed.setAttribute('aria-label', 'Speed');
  for (const [label, ms] of SPEEDS) {
    const o = h('option', null, label);
    o.value = ms;
    if (label === 'Normal') o.selected = true;
    speed.append(o);
  }
  speed.addEventListener('change', () => { if (timer) { stop(); toggle(); } });
  bar.append(first, back, play, fwd, last, speed);
  const count = h('p', 'study-count');
  const now = h('div', 'study-now');
  now.setAttribute('aria-live', 'polite');
  const list = h('ol', 'study-list');
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) { stop(); go(Number(li.dataset.i)); }
  });
  // A /review question (tools/ask.py --review): the replay jumps to its action and the answer goes back to Claude.
  const qBox = h('div', 'lab-question study-question');
  qBox.hidden = true;
  const qHead = h('p', 'lab-q-head');
  const qText = h('p', 'lab-q-text');
  const answer = h('textarea');
  answer.rows = 3;
  answer.placeholder = 'Your answer';
  answer.setAttribute('aria-label', 'Your answer');
  const suits = h('span', 'lab-suits');
  for (const [sym, red] of [['♠', false], ['♥', true], ['♣', false], ['♦', true]]) {
    const b = h('button', red ? 'r' : null, sym);
    b.type = 'button';
    b.setAttribute('aria-label', `Insert ${sym}`);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { answer.setRangeText(sym, answer.selectionStart, answer.selectionEnd, 'end'); answer.focus(); });
    suits.append(b);
  }
  const mic = btn('Speak', null, () => {});
  const send = btn('Send answer', null, sendAnswer);
  const back2 = btn('Go to the question', null, () => { stop(); goToQuestion(); });
  const pair = h('span', 'lab-pair');
  pair.append(mic, send);
  const row = h('div', 'lab-row');
  row.append(suits, pair);
  qBox.append(qHead, qText, answer, row, back2);
  answer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendAnswer(); }
  });
  speech(mic, answer);
  box.append(title, sub, bar, count, qBox, now, list);
  left.prepend(box);
  return { first, back, play, fwd, last, speed, count, now, list, qBox, qHead, qText, answer };
}

function chips(list) {
  const wrap = h('span', 'study-codes');
  for (const c of list) {
    const chip = h('span', 'study-code', c);
    if (names[c]) chip.title = names[c];
    wrap.append(chip);
  }
  return wrap;
}

function fillList() {
  ui.list.replaceChildren();
  steps.forEach((st, i) => {
    const li = h('li');
    li.dataset.i = i;
    if (st.action) {
      li.append(h('span', 'study-n', `#${st.action.n}`), h('span', 'study-act', actionText(st.action)));
      if (st.notes.length || st.answers.length) li.append(h('span', 'study-mark', '✎'));
      li.append(chips(codes[st.action.n] || []));
    } else {
      li.append(h('span', 'study-n', ''), h('span', 'study-act', endText(st.end)));
    }
    ui.list.append(li);
  });
}

function endText(end) {
  if (!end) return 'End';
  return { W: 'Won', L: 'Lost (End game)', quit: 'Forfeited', abandoned: 'Left for a new deal' }[end.result] || 'End';
}

function showNow(st) {
  const box = ui.now;
  box.replaceChildren();
  if (!st.action) {
    box.append(h('p', 'study-head', `${endText(st.end)}${st.end && st.end.moves != null ? ` in ${st.end.moves} moves` : ''}.`));
    if (st.end && st.end.note) box.append(h('p', 'study-note', st.end.note));
    return;
  }
  const a = st.action;
  const head = h('p', 'study-head');
  head.append(h('b', null, `#${a.n} ${actionText(a)}`),
    document.createTextNode(`${a.move_no ? ` · move ${a.move_no}` : ''}${a.auto ? ' · Auto-complete' : ''} · after ${secs(a.think_ms)}`));
  box.append(head);
  for (const n of st.notes) box.append(h('p', 'study-note', n));
  for (const q of st.answers) {
    if (q.question) box.append(h('p', 'study-q', `Claude asked: ${q.question}`));
    box.append(h('p', 'study-note', q.text));
  }
  const list = codes[a.n] || [];
  if (list.length) {
    const p = h('p', 'study-why');
    p.append(chips(list));
    box.append(p);
  }
}

/* ---------- moving through the game ---------- */

function go(i) {
  cur = Math.max(0, Math.min(steps.length - 1, i));
  const st = steps[cur];
  S.state = st.state;
  S.record = st.record;
  S.undoneSeq = [];
  S.history = [];
  S.closed = true;
  render();
  const n = steps.length - 1;
  ui.count.textContent = cur < n ? `Step ${cur + 1} of ${n}: the table before this action` : 'The final table';
  ui.first.disabled = ui.back.disabled = cur === 0;
  ui.fwd.disabled = ui.last.disabled = cur === n;
  if (!timer) ui.play.disabled = cur === n;
  showNow(st);
  for (const li of ui.list.children) {
    li.classList.toggle('cur', Number(li.dataset.i) === cur);
    const st2 = steps[Number(li.dataset.i)];
    li.classList.toggle('asked', !!question && !!st2.action && st2.action.n === question.n);
  }
  const li = ui.list.children[cur];
  if (li) ui.list.scrollTop = Math.max(0, li.offsetTop - ui.list.offsetTop - ui.list.clientHeight / 2);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  ui.play.textContent = 'Play';
  ui.play.disabled = cur === steps.length - 1;
}
function toggle() {
  if (timer) { stop(); return; }
  if (cur === steps.length - 1) return;
  ui.play.textContent = 'Pause';
  timer = setInterval(() => {
    if (cur >= steps.length - 1) { stop(); return; }
    go(cur + 1);
  }, Number(ui.speed.value));
}

document.addEventListener('keydown', (e) => {
  if (!ui || (e.target.closest && e.target.closest('textarea, input, select'))) return;
  const keys = { ArrowLeft: () => go(cur - 1), ArrowRight: () => go(cur + 1), Home: () => go(0), End: () => go(steps.length - 1) };
  if (keys[e.key]) { e.preventDefault(); stop(); keys[e.key](); } else if (e.key === ' ' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
});

/* ---------- /review questions ---------- */

const stepOf = (n) => steps.findIndex((st) => st.action && st.action.n === n);
function goToQuestion() { if (question) { const i = stepOf(question.n); if (i >= 0) go(i); } }

function showQuestion(q) {
  question = q;
  ui.qBox.hidden = !q;
  if (q) {
    const st = steps[stepOf(q.n)];
    ui.qHead.textContent = `Claude asks about #${q.n}${st ? ` (${actionText(st.action)})` : ''}`;
    ui.qText.textContent = q.text;
    stop();
    goToQuestion();
  } else {
    go(cur);
  }
}

async function pollQuestion() {
  try {
    const r = await fetch('/api/question', { cache: 'no-store' });
    const q = r.ok ? await r.json() : {};
    const mine = q.id && q.review && q.game === game ? q : null;
    if ((mine ? mine.id : null) !== (question ? question.id : null)) showQuestion(mine);
  } catch { /* the server may be restarting */ }
}

async function sendAnswer() {
  const text = ui.answer.value.trim();
  if (!text || !question) return;
  try {
    const r = await fetch('/api/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: question.id, text }) });
    if (!r.ok) throw new Error(r.status);
    const st = steps[stepOf(question.n)];
    if (st) st.answers.push({ question: question.text, text });
    ui.answer.value = '';
    showQuestion(null);
    say('Answer sent to Claude.');
  } catch {
    say('Could not send the answer: is ./play still running?');
  }
}

/** Open the replay of a finished game. */
export async function startStudy(id) {
  game = id;
  document.body.classList.add('studying');
  document.title = `Replay ${game} · Play Lab`;
  let data;
  try {
    const r = await fetch(`/api/study?id=${encodeURIComponent(game)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch {
    say(`Could not load game ${game}: is it finished, and is ./play running?`);
    return;
  }
  codes = data.codes || {};
  try {
    const r = await fetch(CODES_URL, { cache: 'no-store' });
    if (r.ok) for (const c of (await r.json()).items || []) names[c.code] = c.name;
  } catch { /* names are only tooltips */ }
  steps = buildSteps(data.events) || [];
  if (!steps.length) { say('This game could not be rebuilt from its log.'); return; }
  ui = buildPanel(game, data.events[0]);
  fillList();
  say('Replay: nothing here is recorded. ← → step, Space plays.');
  go(0);
  setInterval(pollQuestion, QUESTION_POLL_MS);
  pollQuestion();
}
