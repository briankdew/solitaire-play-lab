/*
 * Reading play-lab game logs (games/<id>.jsonl) in Node: the events, the actions that stand
 * after undos, and replaying a game from its deal to check or rebuild every position.
 */
'use strict';
const fs = require('node:fs');
const G = require('../game.js');
const F = require('./features.js');

/** Every event in a log file (one JSON object per line). */
function readEvents(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/**
 * The game's actions (moves and turns of the stock) that were not undone, in order, plus the
 * ones that were (each marked `undone: true`), all in the order they were made.
 */
function actions(events) {
  const all = [];
  const standing = [];
  for (const e of events) {
    if (e.type === 'move' || e.type === 'turn') {
      const a = { ...e, undone: false };
      all.push(a);
      standing.push(a);
    } else if (e.type === 'undo') {
      const i = standing.map((a) => a.n).lastIndexOf(e.undoes);
      if (i >= 0) { standing[i].undone = true; standing.splice(i, 1); }
    }
  }
  return { standing, all };
}

/** The dealt position of a logged game (needs the deal event's deck and settings). */
function dealtState(dealEvent) {
  const order = dealEvent.deck.map((id) => ({ ...G.parseCard(id), faceUp: false }));
  return G.dealPending(G.prepareDeck(order, dealEvent.settings));
}

/** Apply one play by its key ("s" or card + destination). Returns the new state, or null. */
function applyKey(state, key) {
  if (key === 's') return G.draw(state);
  const m = G.legalMoves(state).find((mv) => F.moveKey(state, mv) === key);
  return m ? G.move(state, m.from, m.to) : null;
}

/**
 * Replay the standing actions from the deal: [{ action, before, after }], or throws with the
 * action that doesn't fit.
 */
function replay(events) {
  const deal = events.find((e) => e.type === 'deal');
  if (!deal || !deal.deck) throw new Error('no deal with a deck in this log');
  let state = dealtState(deal);
  const steps = [];
  for (const action of actions(events).standing) {
    const after = applyKey(state, action.key);
    if (!after) throw new Error(`action ${action.n} (${action.key}) does not fit the position`);
    steps.push({ action, before: state, after });
    state = after;
  }
  return { deal, final: state, steps, won: G.isWon(state) };
}

module.exports = { readEvents, actions, dealtState, applyKey, replay };
