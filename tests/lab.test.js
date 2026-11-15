// Play-lab factors and model. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const F = require('../lab/features.js');
const M = require('../lab/model.js');
const valuation = require('../model/valuation.json');

const S4223 = { highest: 4, suits: 2, columns: 2, draw: 3 };
const dealOf = (text, settings = S4223) =>
  G.dealPending(G.prepareDeck(text.split(' ').map((id) => ({ ...G.parseCard(id), faceUp: false })), settings));

// The opening deal from the screenshot (4223, deal 1 in the custom shuffles): a = A♠, b = ?? + 4♥,
// waste 3♠ A♥ 2♠ (2♠ playable), 2 cards left in the stock.
const SCREENSHOT = 'AS 3H 4H 3S AH 2S 4S 2H';
const byKey = (plays) => Object.fromEntries(plays.map((p) => [p.key, p]));

test('screenshot position: the only plays are A♠h and the stock', () => {
  const plays = F.plays(dealOf(SCREENSHOT));
  assert.deepEqual(plays.map((p) => p.key).sort(), ['ASh', 's']);
  assert.deepEqual(plays.map((p) => p.text).sort(), ['A♠h', 's']);
});

test('screenshot position: A♠h starts home, opens a, sets up 4♥a and the reveal under it', () => {
  const p = byKey(F.plays(dealOf(SCREENSHOT)));
  assert.deepEqual(p.ASh.factors, {
    home: 1, starts_home: 1, opens_column: 1, new_home_plays: 1, new_column_plays: 1, sets_up_reveal: 1,
  });
  assert.deepEqual(p.s.factors, { draw: 1, draw_fraction: 0.667 });
});

test('screenshot position: the worked example scores A♠h 2.83 and the stock 0.33', () => {
  const { scores, pick } = M.score(F.plays(dealOf(SCREENSHOT)), valuation);
  assert.equal(scores.ASh, 2.834); // 1 + 0.5 + 0.5 + 0.5 + 0.5 × 0.667
  assert.equal(scores.s, 0.334);
  assert.deepEqual(pick, ['ASh']);
});

test('factors never depend on hidden cards: the same visible position scores the same', () => {
  // Same visible cards, different face-down card and stock order.
  const others = ['AS 2H 4H 3S AH 2S 3H 4S', 'AS 4S 4H 3S AH 2S 2H 3H'];
  const base = JSON.stringify(F.plays(dealOf(SCREENSHOT)));
  for (const text of others) assert.equal(JSON.stringify(F.plays(dealOf(text))), base);
  // And the blanked position holds no hidden card ids.
  const v = JSON.stringify(F.visible(dealOf(SCREENSHOT)));
  for (const id of ['3H', '4S', '2H']) assert.ok(!v.includes(`"${id}"`), id);
});

test('a play that uncovers a face-down card counts as a reveal, without saying which card', () => {
  let s = dealOf(SCREENSHOT);
  s = G.move(s, { pile: 'tableau', index: 0, cardIndex: 0 }, { pile: 'foundation', index: 0 });
  const p = byKey(F.plays(s));
  assert.ok(p['4Ha'], '4♥ can go to the empty column a');
  assert.equal(p['4Ha'].factors.reveals, 1);
  assert.equal(p['4Ha'].factors.fills_column, 1);
  assert.equal(p['2Sh'].factors.home, 1);
  assert.equal(p['2Sh'].factors.promotes, 1);
});

test('turning the stock over a playable waste card buries it', () => {
  let s = dealOf(SCREENSHOT);
  s = G.move(s, { pile: 'tableau', index: 0, cardIndex: 0 }, { pile: 'foundation', index: 0 });
  assert.equal(byKey(F.plays(s)).s.factors.buries_playable, 1);
});

test('an empty stock turns the waste back over: recycles, with the share of a full turn', () => {
  let s = dealOf(SCREENSHOT);
  s = G.draw(s); // the last 2 stock cards
  const p = byKey(F.plays(s));
  assert.equal(p.s.factors.recycles, 1);
  assert.equal(p.s.factors.draw_fraction, 1);
});

test('keys and text name the card and its destination', () => {
  assert.equal(F.keyText('XCa'), 'X♣a');
  assert.equal(F.keyText('s'), 's');
});

/* ---------- benchmark players ---------- */
const B = require('../tools/benchmark.js');

test('benchmark: setup codes give the settings', () => {
  assert.deepEqual(B.settingsOf('4223'), G.normalizeSettings({ highest: 4, suits: 2, columns: 2, draw: 3 }));
  assert.equal(B.settingsOf('K473').highest, 13);
});

test('benchmark: the screenshot deal can be won, and both players win it', () => {
  const dealt = dealOf(SCREENSHOT);
  assert.equal(B.solvable(dealt, 100000), true);
  assert.equal(B.playGame(dealt, B.byValues(valuation), B.rng(1), 500).won, true);
  assert.equal(B.playGame(dealt, B.naive, B.rng(1), 500).won, true);
});

test('benchmark: naive play turns the stock only when no card can be played', () => {
  const plays = F.plays(dealOf(SCREENSHOT));
  const order = B.naive(dealOf(SCREENSHOT), plays, B.rng(3));
  assert.deepEqual(order.map((p) => p.key), ['ASh', 's']);
});

test('log replay: a game rebuilt from its keys reaches the same position', () => {
  const L = require('../lab/log.js');
  const events = [
    { type: 'deal', settings: S4223, deck: SCREENSHOT.split(' ') },
    { type: 'move', n: 1, key: 'ASh' }, { type: 'move', n: 2, key: '2Sh' }, { type: 'undo', undoes: 2 },
    { type: 'move', n: 3, key: '2Sh' }, { type: 'move', n: 4, key: 'AHh' }, { type: 'move', n: 5, key: '3Sh' },
    { type: 'move', n: 6, key: '4Ha' }, { type: 'turn', n: 7, key: 's' }, { type: 'move', n: 8, key: '2Hh' },
    { type: 'move', n: 9, key: '3Hh' }, { type: 'move', n: 10, key: '4Sh' }, { type: 'move', n: 11, key: '4Hh' },
  ];
  const r = L.replay(events);
  assert.equal(r.won, true);
  assert.equal(r.steps.length, 10);
  assert.equal(L.actions(events).all.filter((x) => x.undone).length, 1);
});
