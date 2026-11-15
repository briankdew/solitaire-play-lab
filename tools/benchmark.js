#!/usr/bin/env node
/*
 * Win rates on the same shuffles for several ways of playing, using the game's own rules (game.js).
 *
 *   node tools/benchmark.js 4223                 # 2000 shuffles of setup 4223
 *   node tools/benchmark.js 6233 --games 5000 --seed 7
 *
 * Players (each sees only what the player could see, through lab/features.js):
 *   naive    pure naive play: any card play that can be made, chosen at random when there are
 *            several; the stock is turned only when no card can be played. Card plays taken back
 *            off home are left out (a naive player plays forward).
 *   values   the play with the top total under model/valuation.json (ties at random).
 *   learned  the same with model/learned.json, if tools/fit.py has made one.
 *   best     a perfect-information solver: can the shuffle be won at all, knowing every card?
 *            An upper limit no player can reach without seeing hidden cards. Searches stop
 *            after --nodes positions per shuffle (counted as unknown).
 *
 * Every player avoids repeating a position: a play that leads back to a position already seen in
 * the game is skipped, and a game with no other play left is lost. This is what ends games that
 * would otherwise go round the stock for ever.
 */
'use strict';
const G = require('../game.js');
const F = require('../lab/features.js');
const M = require('../lab/model.js');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const a = { setup: '4223', games: 2000, seed: 1, nodes: 200000, maxActions: 2000 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (k === '--games') a.games = Number(rest[++i]);
    else if (k === '--seed') a.seed = Number(rest[++i]);
    else if (k === '--nodes') a.nodes = Number(rest[++i]);
    else if (/^[2-9XJQKA]\d\d\d$/.test(k)) a.setup = k;
    else throw new Error(`Unknown argument ${k}`);
  }
  return a;
}

/** Settings from a setup code like 4223 or K473. */
function settingsOf(code) {
  return G.normalizeSettings({ highest: G.parseCard(code[0] + 'S').rank, suits: Number(code[1]), columns: Number(code[2]), draw: Number(code[3]) });
}

/** A repeatable random number generator (xorshift32), from a seed. */
function rng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

/** A position as a string, for spotting repeats (every card, hidden ones included). */
const keyOf = (s) => s.stock.map((c) => c.id).join('') + '|' + s.waste.map((c) => c.id).join('') + '|' +
  s.tableau.map((col) => col.map((c) => (c.faceUp ? c.id : c.id.toLowerCase())).join('')).join('/') + '|' +
  s.foundations.map((p) => p.length).join('');

function apply(state, play) {
  return play.kind === 'draw' ? G.draw(state) : G.move(state, play.from, play.to);
}

/**
 * Play one game: `choose(state, plays, random)` returns plays in order of preference; the first
 * that doesn't repeat a position is made. Returns { won, actions }.
 */
function playGame(dealt, choose, random, maxActions) {
  let state = dealt;
  const seen = new Set([keyOf(state)]);
  for (let actions = 0; actions < maxActions; actions++) {
    if (G.isWon(state)) return { won: true, actions };
    const plays = F.plays(state);
    if (!plays.length) return { won: false, actions };
    let moved = false;
    for (const play of choose(state, plays, random)) {
      const next = apply(state, play);
      const k = next && keyOf(next);
      if (!next || seen.has(k)) continue;
      seen.add(k);
      state = next;
      moved = true;
      break;
    }
    if (!moved) return { won: false, actions };
  }
  return { won: G.isWon(state), actions: maxActions };
}

function shuffled(list, random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Pure naive play: card plays (not off home) at random first, the stock only after them. */
function naive(state, plays, random) {
  const cards = plays.filter((p) => p.kind === 'move' && !p.factors.from_home);
  const draw = plays.filter((p) => p.kind === 'draw');
  return [...shuffled(cards, random), ...draw];
}

/** Highest total first, ties in random order. */
function byValues(valuation) {
  return (state, plays, random) => {
    const { scores } = M.score(plays, valuation);
    return shuffled(plays, random).sort((x, y) => scores[y.key] - scores[x.key]);
  };
}

/** Can this shuffle be won by someone who sees every card? true, false, or null (search too big). */
function solvable(dealt, nodeLimit) {
  const seen = new Set();
  let nodes = 0;
  const stack = [dealt];
  seen.add(keyOf(dealt));
  while (stack.length) {
    const s = stack.pop();
    if (G.isWon(s)) return true;
    if (++nodes > nodeLimit) return null;
    const next = G.legalMoves(s).map((m) => G.move(s, m.from, m.to));
    const d = G.draw(s);
    if (d) next.push(d);
    for (const n of next) {
      const k = keyOf(n);
      if (!seen.has(k)) { seen.add(k); stack.push(n); }
    }
  }
  return false;
}

/** 95% interval for a share (Wilson). */
function interval(wins, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = wins / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function main() {
  const a = parseArgs(process.argv);
  const settings = settingsOf(a.setup);
  const players = { naive };
  const values = readJson(path.join(__dirname, '..', 'model', 'valuation.json'));
  if (values) players.values = byValues(values);
  const learned = readJson(path.join(__dirname, '..', 'model', 'learned.json'));
  if (learned) players.learned = byValues(learned);

  const results = Object.fromEntries(Object.keys(players).map((k) => [k, { wins: 0, actions: 0 }]));
  const best = { wins: 0, unknown: 0 };
  for (let i = 0; i < a.games; i++) {
    const dealt = G.dealPending(G.prepareDeal(rng(a.seed * 1000003 + i), settings));
    for (const [name, choose] of Object.entries(players)) {
      const r = playGame(dealt, choose, rng(a.seed * 7919 + i * 31 + name.length), a.maxActions);
      results[name].wins += r.won ? 1 : 0;
      results[name].actions += r.actions;
    }
    const s = solvable(dealt, a.nodes);
    if (s === true) best.wins += 1;
    if (s === null) best.unknown += 1;
  }

  console.log(`Setup ${a.setup}: ${a.games} shuffles (seed ${a.seed})\n`);
  console.log('player     wins     95% interval     average actions');
  for (const [name, r] of Object.entries(results)) {
    const [lo, hi] = interval(r.wins, a.games);
    console.log(`${name.padEnd(9)} ${(r.wins / a.games * 100).toFixed(1).padStart(5)}%   ${(lo * 100).toFixed(1).padStart(5)}–${(hi * 100).toFixed(1).padEnd(5)}%    ${(r.actions / a.games).toFixed(1)}`);
  }
  const [lo, hi] = interval(best.wins, a.games);
  console.log(`${'best'.padEnd(9)} ${(best.wins / a.games * 100).toFixed(1).padStart(5)}%   ${(lo * 100).toFixed(1).padStart(5)}–${(hi * 100).toFixed(1).padEnd(5)}%    (perfect information${best.unknown ? `; ${best.unknown} too big to search, counted as losses` : ''})`);
}

if (require.main === module) main();
module.exports = { settingsOf, rng, playGame, naive, byValues, solvable };
