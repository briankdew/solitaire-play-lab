// Played shuffles: the list of shuffles dealt in the play lab (from server.py), each with its
// shuffle ID, how often it was played and how those games ended, and a Replay button that deals it
// again. Shows no cards: a shuffle's deck order is fetched only when it is replayed.
import { G, S, inPlay, say } from './shared.js';
import { confirmReshuffle, dealShuffle, prepareNewShuffle } from './actions.js';
import { applySettings } from './settings.js';

const el = (id) => document.getElementById(id);
const openBtn = el('replayBtn');
const modal = el('replayModal');
const card = el('replayCard');
const setupSel = el('replaySetup');
const searchEl = el('replaySearch');
const listEl = el('replayList');
const countEl = el('replayCount');
const moreBtn = el('replayMore');
const closeBtn = el('replayClose');

const PAGE = 50;
let items = [];
let total = 0;
let busy = false;

/** Settings from a setup code like 4223 or K473. */
export function settingsOfSetup(code) {
  return G.normalizeSettings({
    highest: G.parseCard(code[0] + 'S').rank, suits: Number(code[1]), columns: Number(code[2]), draw: Number(code[3]),
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function resultsText(s) {
  const parts = [];
  if (s.W) parts.push(`won ${s.W}`);
  if (s.L) parts.push(`lost ${s.L}`);
  if (s.quit) parts.push(`quit ${s.quit}`);
  if (s.abandoned) parts.push(`left ${s.abandoned}`);
  return parts.join(', ');
}
const dateOf = (t) => (t ? t.slice(0, 10) : '');

function row(s) {
  const li = document.createElement('li');
  li.className = 'replay-row';
  const info = document.createElement('div');
  const id = document.createElement('div');
  id.className = 'replay-id';
  id.textContent = s.id;
  const meta = document.createElement('div');
  meta.className = 'replay-meta';
  const bits = [plural(s.plays, 'game')];
  const r = resultsText(s);
  if (r) bits.push(r);
  if (s.last) bits.push(`last ${dateOf(s.last)}`);
  meta.textContent = bits.join(' · ');
  info.append(id, meta);
  if (s.mirror_of && s.mirror_of.length) {
    const m = document.createElement('div');
    m.className = 'replay-meta';
    m.textContent = `Mirror of ${s.mirror_of.join(', ')}`;
    info.append(m);
  }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small';
  btn.textContent = 'Replay';
  btn.addEventListener('click', () => replay(s.id));
  li.append(info, btn);
  return li;
}

function render() {
  listEl.replaceChildren(...items.map(row));
  countEl.textContent = total
    ? `${plural(total, 'shuffle')}${items.length < total ? `, showing ${items.length}` : ''}`
    : (searchEl.value.trim() ? 'No shuffle matches.' : 'No shuffles played with this setup yet.');
  moreBtn.hidden = items.length >= total;
}

async function load(reset) {
  if (reset) items = [];
  const q = new URLSearchParams({ setup: setupSel.value, q: searchEl.value.trim(), offset: items.length, limit: PAGE });
  try {
    const r = await fetch(`/api/shuffles?${q}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const data = await r.json();
    items = items.concat(data.items);
    total = data.total;
    render();
  } catch {
    countEl.textContent = 'Could not load the list: is ./play still running?';
  }
}

async function open() {
  if (S.busy) return;
  let setups = {};
  try {
    const r = await fetch('/api/setups', { cache: 'no-store' });
    if (r.ok) setups = await r.json();
  } catch { /* shown below */ }
  const current = setupOf(S.settings);
  const codes = Object.keys(setups);
  if (!codes.includes(current)) codes.unshift(current);
  setupSel.innerHTML = '';
  for (const code of codes) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = `${code} (${setups[code] || 0})`;
    setupSel.append(o);
  }
  setupSel.value = current;
  searchEl.value = '';
  modal.hidden = false;
  card.focus({ preventScroll: true });
  load(true);
}

function close() {
  modal.hidden = true;
  openBtn.focus({ preventScroll: true });
}

const setupOf = (s) => G.RANK_LABEL[s.highest] + s.suits + s.columns + s.draw;

async function replay(id) {
  if (busy || S.busy) return;
  busy = true;
  try {
    const r = await fetch(`/api/shuffle?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    const s = await r.json();
    const settings = settingsOfSetup(s.setup);
    const prepared = G.prepareDeck(s.deck.map((c) => ({ ...G.parseCard(c), faceUp: false })), settings);
    modal.hidden = true;
    if (inPlay() && !(await confirmReshuffle())) { modal.hidden = false; return; }
    applySettings(settings);
    prepareNewShuffle(prepared);
    dealShuffle();
    say(`Replaying shuffle ${s.id}. Good luck!`);
  } catch {
    countEl.textContent = 'Could not load that shuffle: is ./play still running?';
  } finally {
    busy = false;
  }
}

/** The button works only with the server running (the list lives there). */
export function setReplayAvailable(on) {
  openBtn.disabled = !on;
}

openBtn.addEventListener('click', open);
closeBtn.addEventListener('click', close);
moreBtn.addEventListener('click', () => load(false));
setupSel.addEventListener('change', () => load(true));
let searchTimer = 0;
searchEl.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => load(true), 200); });
modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
