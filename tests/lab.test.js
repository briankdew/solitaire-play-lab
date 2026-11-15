// Play-lab plays, log replay and the naive player. Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../game.js');
const P = require('../lab/plays.js');
const L = require('../lab/log.js');
const B = require('../tools/benchmark.js');

const S4223 = { highest: 4, suits: 2, columns: 2, draw: 3 };
const dealOf = (text, settings = S4223) =>
  G.dealPending(G.prepareDeck(text.split(' ').map((id) => ({ ...G.parseCard(id), faceUp: false })), settings));

// 4223 deal 1 in the custom shuffles: a = A♠, b = ?? + 4♥, waste 3♠ A♥ 2♠ (2♠ playable), 2 cards in the stock.
const DEAL1 = 'AS 3H 4H 3S AH 2S 4S 2H';

test('plays: 4223 deal 1 opens with A♠h and the stock', () => {
  const plays = P.plays(dealOf(DEAL1));
  assert.deepEqual(plays.map((p) => p.key), ['ASh', 's']);
  assert.deepEqual(plays.map((p) => p.text), ['A♠h', 's']);
});

test('plays: a run already starting a column is not offered to another empty column', () => {
  let s = dealOf(DEAL1);
  s = G.move(s, { pile: 'tableau', index: 0, cardIndex: 0 }, { pile: 'foundation', index: 0 });
  s = G.move(s, { pile: 'tableau', index: 1, cardIndex: 1 }, { pile: 'tableau', index: 0 });   // 4♥a
  assert.ok(!P.plays(s).some((p) => p.key === '4Hb'));
});

test('plays and the description never depend on hidden cards', () => {
  const base = JSON.stringify([P.plays(dealOf(DEAL1)).map((p) => p.key), P.describe(dealOf(DEAL1))]);
  for (const text of ['AS 2H 4H 3S AH 2S 3H 4S', 'AS 4S 4H 3S AH 2S 2H 3H']) {
    assert.equal(JSON.stringify([P.plays(dealOf(text)).map((p) => p.key), P.describe(dealOf(text))]), base);
  }
});

test('describe: the visible position', () => {
  assert.deepEqual(P.describe(dealOf(DEAL1)), {
    stock: 2, waste: ['3S', 'AH', '2S'], under: 0,
    cols: [{ down: 0, up: ['AS'] }, { down: 1, up: ['4H'] }], home: [null, null],
  });
});

test('keys and text name the card and its destination', () => {
  assert.equal(P.keyText('XCa'), 'X♣a');
  assert.equal(P.keyText('s'), 's');
});

test('log replay: a game rebuilt from its keys reaches the same position, undos skipped', () => {
  const events = [
    { type: 'deal', settings: S4223, deck: DEAL1.split(' ') },
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

test('benchmark: setup codes give the settings', () => {
  assert.deepEqual(B.settingsOf('4223'), G.normalizeSettings(S4223));
  assert.equal(B.settingsOf('K473').highest, 13);
});

test('benchmark: naive play turns the stock only when no card can be played', () => {
  const s = dealOf(DEAL1);
  assert.deepEqual(B.naive(s, P.plays(s), B.rng(3)).map((p) => p.key), ['ASh', 's']);
});

test('benchmark: deal 1 can be won, and a game of naive play ends', () => {
  const dealt = dealOf(DEAL1);
  assert.equal(B.solvable(dealt, 100000), true);
  assert.equal(typeof B.playGame(dealt, B.naive, B.rng(1), 500).won, 'boolean');
});
