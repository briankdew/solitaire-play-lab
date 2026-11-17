/*
 * Reading play-lab game logs (games/<id>.jsonl) in Node: the events, the actions that stand
 * after undos, and replaying a game from its deal to check or rebuild every position.
 */
'use strict';
const fs = require('node:fs');
const G = require('../game.js');
const P = require('./plays.js');

/** Every event in a log file (one JSON object per line). */
function readEvents(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// The shared rebuilding helpers live in lab/plays.js (the browser's Resume and Replay use them too).
const { actions, dealtState } = P;

/** Apply one play by its key ("s" or card + destination). Returns the new state, or null. */
function applyKey(state, key) {
  const r = P.apply(state, key);
  return r ? r.state : null;
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
