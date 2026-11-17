// Card art: imported SVG card faces and backs, chosen independently in the settings (Card faces,
// Card backs). The server keeps them in cardart/ (not committed). A face set is one SVG per card, named
// for its card (AS.svg, 10H.svg, ace_of_spades.svg, …); cards a set lacks keep the built-in face. Art
// is stretched to the card. Files are shown as images, so nothing inside an SVG runs.
import { S, say } from './shared.js';
import { rebuildCards } from './table.js';

const el = (id) => document.getElementById(id);
const faceSel = el('faceArtSel');
const backSel = el('backArtSel');
const faceFile = el('faceArtFile');
const backFile = el('backArtFile');
const FACE_KEY = 'solitaire-play-lab.faceArt';
const BACK_KEY = 'solitaire-play-lab.backArt';
const BUILT_IN = '';

let art = { faces: [], backs: [] };

/* ---------- which card a file is ---------- */

const RANKS = {
  a: 'A', ace: 'A', 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: 'X', t: 'X', x: 'X', ten: 'X', j: 'J', jack: 'J', 11: 'J', q: 'Q', queen: 'Q', 12: 'Q', k: 'K', king: 'K', 13: 'K',
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};
const SUITS = { s: 'S', spade: 'S', spades: 'S', h: 'H', heart: 'H', hearts: 'H', c: 'C', club: 'C', clubs: 'C', d: 'D', diamond: 'D', diamonds: 'D' };

/**
 * The card a file name names, as a card id (AS, XH, …), or null: compact names (AS, 10h, s1, KD)
 * and word names (ace_of_spades, 10_of_hearts, king-clubs, spade_13). A number after a word
 * (jack_of_spades2, an alternative design) is ignored.
 */
export function cardIdOf(fileName) {
  const name = fileName.toLowerCase().replace(/\.svg$/, '');
  const flat = name.replace(/[^a-z0-9]/g, '');
  let m = flat.match(/^(10|1[1-3]|[1-9]|[atxjqk])([shcd])$/);
  if (m) return RANKS[m[1]] + SUITS[m[2]];
  m = flat.match(/^([shcd])(10|1[1-3]|[1-9]|[atxjqk])$/);
  if (m) return RANKS[m[2]] + SUITS[m[1]];
  let rank = null; let suit = null;
  for (const t of name.split(/[^a-z0-9]+/).filter(Boolean)) {
    const word = /[a-z]/.test(t) ? t.replace(/\d+$/, '') : t;
    if (!suit && SUITS[word] && word.length > 1) suit = SUITS[word];
    else if (!rank && RANKS[word] !== undefined) rank = RANKS[word];
  }
  return rank && suit ? rank + suit : null;
}

/* ---------- showing the art in use ---------- */

const remember = (key, v) => { try { localStorage.setItem(key, v); } catch { /* ignore */ } };
const recall = (key) => { try { return localStorage.getItem(key) || BUILT_IN; } catch { return BUILT_IN; } };

function applyFaces(name) {
  const set = art.faces.find((f) => f.name === name);
  S.faceArt = set ? { set: set.name, cards: new Set(set.cards) } : null;
  faceSel.value = set ? set.name : BUILT_IN;
  rebuildCards();
}
function applyBack(name) {
  const wrap = document.querySelector('.table-wrap');
  const ok = art.backs.includes(name);
  if (ok) wrap.style.setProperty('--back-art', `url("/cardart/backs/${encodeURIComponent(name)}.svg")`);
  else wrap.style.removeProperty('--back-art');
  wrap.toggleAttribute('data-back-art', ok);
  backSel.value = ok ? name : BUILT_IN;
}

function fill(sel, names) {
  sel.replaceChildren(new Option('Built-in', BUILT_IN), ...names.map((n) => new Option(n, n)));
}

async function load() {
  try {
    const r = await fetch('/api/cardart', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    art = await r.json();
  } catch {
    art = { faces: [], backs: [] };   // no server (or an older one): built-in only
  }
  fill(faceSel, art.faces.map((f) => `${f.name}`));
  fill(backSel, art.backs);
  for (const o of faceSel.options) {
    const set = art.faces.find((f) => f.name === o.value);
    if (set && set.cards.length < 52) o.textContent = `${set.name} (${set.cards.length} cards)`;
  }
  applyFaces(recall(FACE_KEY));
  applyBack(recall(BACK_KEY));
}

/* ---------- importing and removing ---------- */

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => r.json().then((j) => { if (!r.ok) throw new Error(j.error || r.status); return j; }));

/** The file's text if it is an SVG document of 5 MB or less (checked here first; the server checks again), else null. */
const MAX_FILE = 5 * 1024 * 1024;   // the server takes a little more, for the JSON around it
async function svgText(f) {
  if (f.size > MAX_FILE) return null;
  const text = await f.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  return doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' ? null : text;
}

/** A name the server accepts: letters, digits, spaces, _ . - (up to 40), starting with a letter or digit. */
const cleanName = (s) => s.replace(/[^A-Za-z0-9 _.-]/g, '').replace(/^[^A-Za-z0-9]+/, '').slice(0, 40).trim();

async function importFaces() {
  const files = [...faceFile.files];
  faceFile.value = '';
  if (!files.length) return;
  const byCard = new Map();
  const skipped = [];
  for (const f of files) {
    const id = cardIdOf(f.name);
    if (id && !byCard.has(id)) byCard.set(id, f);
    else skipped.push(f.name);
  }
  if (!byCard.size) { say('None of those file names name a card (for example AS.svg, 10H.svg or ace_of_spades.svg).'); return; }
  const name = cleanName(window.prompt(`Name for this set of card faces (${byCard.size} cards):`, `Faces ${art.faces.length + 1}`) || '');
  if (!name) return;
  say(`Importing ${byCard.size} card faces…`);
  const failed = [];
  for (const [card, f] of byCard) {
    try {
      const text = await svgText(f);
      if (!text) throw new Error('not an SVG file');
      await post('/api/cardart', { kind: 'face', set: name, card, svg: text });
    } catch { failed.push(f.name); }
  }
  remember(FACE_KEY, name);
  await load();
  const notes = [];
  if (skipped.length) notes.push(`skipped ${skipped.length} (not a card, or a second design of one): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`);
  if (failed.length) notes.push(`${failed.length} not valid SVG (or over 5 MB): ${failed.slice(0, 4).join(', ')}`);
  say(`Imported ${byCard.size - failed.length} card faces as "${name}".${notes.length ? ' ' + notes.join('; ') + '.' : ''}`);
}

async function importBack() {
  const f = backFile.files[0];
  backFile.value = '';
  if (!f) return;
  if (!(await svgText(f))) { say(`Could not import ${f.name}: not an SVG file, or over 5 MB.`); return; }
  const name = cleanName(window.prompt('Name for this card back:', cleanName(f.name.replace(/\.svg$/i, '')) || 'Back') || '');
  if (!name) return;
  try {
    const text = await svgText(f);
    if (!text) throw new Error('not an SVG file');
    await post('/api/cardart', { kind: 'back', name, svg: text });
    remember(BACK_KEY, name);
    await load();
    say(`Imported the card back "${name}".`);
  } catch (e) {
    say(`Could not import ${f.name}: ${e.message}.`);
  }
}

async function remove(kind) {
  const sel = kind === 'face' ? faceSel : backSel;
  const name = sel.value;
  if (!name) { say('The built-in design can\'t be removed.'); return; }
  if (!window.confirm(`Remove the card ${kind === 'face' ? 'faces' : 'back'} "${name}" from this computer?`)) return;
  try {
    await post('/api/cardart/delete', { kind, name });
    await load();
    say(`Removed "${name}".`);
  } catch (e) {
    say(`Could not remove "${name}": ${e.message}.`);
  }
}

faceSel.addEventListener('change', () => { remember(FACE_KEY, faceSel.value); applyFaces(faceSel.value); });
backSel.addEventListener('change', () => { remember(BACK_KEY, backSel.value); applyBack(backSel.value); });
/* ---------- before importing: what makes a file fit ---------- */

const infoModal = el('artInfoModal');
const infoCard = el('artInfoCard');
let infoFor = null;   // the file input that Choose files… opens
function showInfo(kind) {
  infoFor = kind === 'face' ? faceFile : backFile;
  el('artInfoTitle').textContent = kind === 'face' ? 'Import card faces' : 'Import a card back';
  el('artInfoFaces').hidden = kind !== 'face';
  el('artInfoBacks').hidden = kind === 'face';
  infoModal.hidden = false;
  infoCard.focus({ preventScroll: true });
}
function hideInfo() { infoModal.hidden = true; }
el('artInfoChoose').addEventListener('click', () => { hideInfo(); infoFor.click(); });
el('artInfoCancel').addEventListener('click', hideInfo);
infoModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideInfo(); });
infoModal.addEventListener('click', (e) => { if (e.target === infoModal) hideInfo(); });

el('faceArtImport').addEventListener('click', () => showInfo('face'));
el('backArtImport').addEventListener('click', () => showInfo('back'));
el('faceArtRemove').addEventListener('click', () => remove('face'));
el('backArtRemove').addEventListener('click', () => remove('back'));
faceFile.addEventListener('change', importFaces);
backFile.addEventListener('change', importBack);
load();
