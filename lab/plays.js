/*
 * Play-lab plays: the plays available in a position, and the position as the player sees it.
 *
 * A play is a card move (G.legalMoves) or a turn of the stock ("s"). Each play gets a key: the
 * card and where it goes for a move ("ASh", "4Ha", a run named by its bottom card), or "s" for
 * the stock. The same keys are used in the game logs and the tools.
 *
 * Nothing here judges or scores a play: that is what the lab is for.
 *
 * Works as a browser global (window.LabPlays, after game.js) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../game.js'));
  else root.LabPlays = factory(root.SixCard);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const top = (pile) => pile[pile.length - 1];

  /** A move's key: the card moved (bottom card of a run) and its destination letter. */
  function moveKey(state, m) {
    const card = G.pickUp(state, m.from)[0];
    const dest = m.to.pile === 'foundation' ? 'h' : G.COLUMN_LETTERS[m.to.index];
    return card.id + dest;
  }

  /** Symbols for a key, for people: "ASh" -> "A♠h", "s" -> "s". */
  function keyText(key) {
    if (key === 's') return 's';
    const sym = { S: '♠', H: '♥', C: '♣', D: '♦' };
    return key[0] + (sym[key[1]] || key[1]) + key.slice(2);
  }

  /** A run that already starts a column moving to another empty column changes nothing. */
  function isPointless(state, m) {
    if (m.from.pile !== 'tableau' || m.to.pile !== 'tableau') return false;
    const ci = m.from.cardIndex == null ? state.tableau[m.from.index].length - 1 : m.from.cardIndex;
    return ci === 0 && state.tableau[m.to.index].length === 0;
  }

  /**
   * Every play in a position: [{ key, text, kind: 'move' | 'draw', from?, to? }]. Moves that
   * change nothing (a run that already starts a column, to another empty column) are left out.
   * Uses only visible cards: legal moves depend only on face-up cards, and the stock is "s".
   */
  function plays(state) {
    if (!state || state.pending) return [];
    const out = G.legalMoves(state)
      .filter((m) => !isPointless(state, m))
      .map((m) => {
        const key = moveKey(state, m);
        return { key, text: keyText(key), kind: 'move', from: m.from, to: m.to };
      });
    if (G.hasHiddenWaste(state)) out.push({ key: 's', text: 's', kind: 'draw' });
    return out;
  }

  /**
   * A compact, visible-only description of a position for the logs:
   * { stock: cards left, waste: the fan (playable last), under: waste cards under the fan,
   *   cols: [{ down: face-down count, up: [ids] }], home: [top id or null, per suit] }.
   */
  function describe(state) {
    const fan = G.fanIds(state);
    return {
      stock: state.stock.length,
      waste: fan,
      under: state.waste.length - fan.length,
      cols: state.tableau.map((col) => ({
        down: col.filter((c) => !c.faceUp).length,
        up: col.filter((c) => c.faceUp).map((c) => c.id),
      })),
      home: state.foundations.map((pile) => (pile.length ? top(pile).id : null)),
    };
  }

  return { plays, keyText, moveKey, describe };
});
