// Played shuffle: the shuffles dealt in the play lab (from server.py), in three sections:
//   Method games  shuffles with games that count toward the model
//   Exploratory   shuffles with exploratory games (a shuffle can be in both)
//   Paused        games stopped with Pause game, to be resumed
//   Deleted       deleted shuffles, which can be restored
// Each row has the shuffle ID, how often it was played and how those games ended, and buttons to
// replay or delete it (or restore it). Shows no cards: a deck order is fetched only to replay it.
import { G, S, inPlay, say } from './shared.js';
import { confirmReshuffle, dealShuffle, prepareNewShuffle, resumeGame } from './actions.js';
import { applySettings } from './settings.js';
import { shuffleInPlay } from './lab.js';

const el = (id) => document.getElementById(id);
const openBtn = el('replayBtn');
const modal = el('replayModal');
const card = el('replayCard');
const tabs = [...document.querySelectorAll('.replay-tab')];
const setupSel = el('replaySetup');
const searchEl = el('replaySearch');
const listEl = el('replayList');
const countEl = el('replayCount');
const moreBtn = el('replayMore');
const closeBtn = el('replayClose');

const PAGE = 50;
let kind = 'method';   // 'method' | 'exploratory' | 'paused' | 'deleted'
let items = [];
let total = 0;
let busy = false;
let loadSeq = 0;   // only the newest load updates the list (switching sections or typing quickly)

/** Settings from a setup code like 4223 or K473. */
export function settingsOfSetup(code) {
  return G.normalizeSettings({
    highest: G.parseCard(code[0] + 'S').rank, suits: Number(code[1]), columns: Number(code[2]), draw: Number(code[3]),
  });
}
const setupOf = (s) => G.RANK_LABEL[s.highest] + s.suits + s.columns + s.draw;
const setupOfId = (id) => id.split('-')[0];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
function resultsText(s) {
  const parts = [];
  if (s.W) parts.push(`won ${s.W}`);
  if (s.L) parts.push(`lost ${s.L}`);
  if (s.quit) parts.push(`forfeited ${s.quit}`);
  if (s.abandoned) parts.push(`left ${s.abandoned}`);
  return parts.join(', ');
}
const dateOf = (t) => (t ? t.slice(0, 10) : '');

function textEl(cls, text) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
}
function button(text, onClick, cls = 'btn small') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function row(s) {
  const li = document.createElement('li');
  li.className = 'replay-row';
  const info = document.createElement('div');
  const actions = document.createElement('div');
  actions.className = 'replay-actions';
  info.append(textEl('replay-id', s.id || s.shuffle));
  if (kind === 'paused') {
    info.append(textEl('replay-meta', `${plural(s.moves || 0, 'move')} · paused ${dateOf(s.t)} ${s.t ? s.t.slice(11, 16) : ''}`));
    actions.append(button('Resume', () => resume(s.game)));
  } else if (kind === 'deleted') {
    info.append(textEl('replay-meta', `${plural(s.games, 'game')} · deleted ${dateOf(s.t)}`));
    actions.append(button('Restore', () => restore(s.id)));
  } else {
    const bits = [plural(s.plays, kind === 'exploratory' ? 'exploratory game' : 'game')];
    const r = resultsText(s);
    if (r) bits.push(r);
    if (s.last) bits.push(`last ${dateOf(s.last)}`);
    info.append(textEl('replay-meta', bits.join(' · ')));
    const other = kind === 'method' ? s.games.exploratory : s.games.method;
    if (other) info.append(textEl('replay-meta', `Also ${plural(other, kind === 'method' ? 'exploratory game' : 'method game')}`));
    if (s.mirror_of && s.mirror_of.length) info.append(textEl('replay-meta', `Mirror of ${s.mirror_of.join(', ')}`));
    const del = button('Delete', () => askDelete(li, s));
    if (shuffleInPlay() === s.id) { del.disabled = true; del.title = 'This shuffle is being played'; }
    actions.append(button('Replay', () => replay(s.id)), del);
  }
  li.append(info, actions);
  return li;
}

/** Deleting asks first, in the row: the shuffle and every game of it, of both kinds. */
function askDelete(li, s) {
  const games = s.games.method + s.games.exploratory;
  const actions = li.querySelector('.replay-actions');
  const msg = textEl('replay-confirm', `Delete it and its ${plural(games, 'game')}?`);
  actions.replaceChildren(msg,
    button('Delete', () => remove(s.id)),
    button('Cancel', () => li.replaceWith(row(s))));
  actions.lastChild.focus();
}

function render() {
  listEl.replaceChildren(...items.map(row));
  const empty = searchEl.value.trim() ? 'No shuffle matches.'
    : kind === 'deleted' ? 'No deleted shuffles with this setup.' : kind === 'paused' ? 'No paused games with this setup.'
      : kind === 'exploratory' ? 'No exploratory games with this setup yet.' : 'No shuffles played with this setup yet.';
  countEl.textContent = total ? `${plural(total, kind === 'paused' ? 'paused game' : 'shuffle')}${items.length < total ? `, showing ${items.length}` : ''}` : empty;
  moreBtn.hidden = items.length >= total;
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.status);
  return data;
}

async function load(reset) {
  const seq = ++loadSeq;
  listEl.setAttribute('aria-busy', 'true');   // until the newest load has shown
  const base = reset ? [] : items;
  try {
    if (kind === 'paused') {
      const q = searchEl.value.trim().toLowerCase();
      const all = (await getJson('/api/paused')).items.filter((d) => d.setup === setupSel.value &&
        (!q || (/^\d+$/.test(q) ? Number((d.shuffle || '').split('-')[1]) === Number(q) : (d.shuffle || '').toLowerCase().includes(q))));
      if (seq !== loadSeq) return;
      items = all;
      total = all.length;
    } else if (kind === 'deleted') {
      // Deleted shuffles are few: filter them here, by setup and by counter or part of the ID.
      const q = searchEl.value.trim().toLowerCase();
      const all = (await getJson('/api/deleted')).items.filter((d) => setupOfId(d.id) === setupSel.value &&
        (!q || (/^\d+$/.test(q) ? Number(d.id.split('-')[1]) === Number(q) : d.id.toLowerCase().includes(q))));
      if (seq !== loadSeq) return;
      items = all;
      total = all.length;
    } else {
      const q = new URLSearchParams({ setup: setupSel.value, kind, q: searchEl.value.trim(), offset: base.length, limit: PAGE });
      const data = await getJson(`/api/shuffles?${q}`);
      if (seq !== loadSeq) return;
      items = base.concat(data.items);
      total = data.total;
    }
    render();
  } catch {
    if (seq === loadSeq) countEl.textContent = 'Could not load the list: is ./play still running?';
  } finally {
    if (seq === loadSeq) listEl.setAttribute('aria-busy', 'false');
  }
}

/** The setup menu: the setups with shuffles in this section (with how many), plus the current one. */
async function fillSetups() {
  let counts = {};
  try {
    if (kind === 'paused') {
      for (const d of (await getJson('/api/paused')).items) counts[d.setup] = (counts[d.setup] || 0) + 1;
    } else if (kind === 'deleted') {
      for (const d of (await getJson('/api/deleted')).items) counts[setupOfId(d.id)] = (counts[setupOfId(d.id)] || 0) + 1;
    } else {
      counts = await getJson(`/api/setups?kind=${kind}`);
    }
  } catch { /* the list shows the error */ }
  const wanted = setupSel.value || setupOf(S.settings);
  const codes = Object.keys(counts).sort();
  if (!codes.includes(wanted)) codes.unshift(wanted);
  setupSel.innerHTML = '';
  for (const code of codes) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = `${code} (${counts[code] || 0})`;
    setupSel.append(o);
  }
  setupSel.value = wanted;
}

async function showKind(k) {
  kind = k;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.kind === k));
  await fillSetups();
  load(true);
}

async function open() {
  if (S.busy) return;
  setupSel.value = '';
  setupSel.innerHTML = '';
  searchEl.value = '';
  modal.hidden = false;
  card.focus({ preventScroll: true });
  await showKind(kind);
}

function close() {
  modal.hidden = true;
  openBtn.focus({ preventScroll: true });
}

async function replay(id) {
  if (busy || S.busy) return;
  busy = true;
  try {
    const s = await getJson(`/api/shuffle?id=${encodeURIComponent(id)}`);
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

async function resume(gameId) {
  if (busy || S.busy) return;
  busy = true;
  try {
    const data = await getJson(`/api/game?id=${encodeURIComponent(gameId)}`);
    modal.hidden = true;
    if (inPlay() && !(await confirmReshuffle())) { modal.hidden = false; return; }
    applySettings(data.events[0].settings);
    resumeGame(data.game, data.events);
  } catch {
    countEl.textContent = 'Could not load that game: is ./play still running?';
  } finally {
    busy = false;
  }
}

async function remove(id) {
  if (busy) return;
  busy = true;
  try {
    const r = await postJson('/api/delete', { id });
    await fillSetups();
    await load(true);
    countEl.textContent = `Deleted ${id} (${plural(r.games, 'game')}). It can be restored from Deleted. ` + countEl.textContent;
  } catch (e) {
    countEl.textContent = `Could not delete ${id}: ${e.message}`;
  } finally {
    busy = false;
  }
}

async function restore(id) {
  if (busy) return;
  busy = true;
  try {
    const r = await postJson('/api/restore', { id });
    await fillSetups();
    await load(true);
    countEl.textContent = `Restored ${id} (${plural(r.games, 'game')}). ` + countEl.textContent;
  } catch (e) {
    countEl.textContent = `Could not restore ${id}: ${e.message}`;
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
for (const t of tabs) t.addEventListener('click', () => showKind(t.dataset.kind));
setupSel.addEventListener('change', () => load(true));
let searchTimer = 0;
searchEl.addEventListener('input', () => { listEl.setAttribute('aria-busy', 'true'); clearTimeout(searchTimer); searchTimer = setTimeout(() => load(true), 200); });
modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
