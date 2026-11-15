/*
 * Play-lab factors: what each play available in a position does, measured only from what the
 * player can see.
 *
 * A play is a card move (G.legalMoves) or a turn of the stock ("s"). Each play gets a key: the
 * card and where it goes for a move ("ASh", "4Ha", a run named by its bottom card), or "s" for
 * the stock. The same keys are used in the game logs, the model and the reports.
 *
 * Hidden cards never count: the stock and every face-down column card are replaced by blanks
 * before anything is worked out, so a card turned over by a play stays unknown here.
 *
 * Works as a browser global (window.LabFeatures, after game.js) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../game.js'));
  else root.LabFeatures = factory(root.SixCard);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  const BLANK = '??';
  const top = (pile) => pile[pile.length - 1];
  const blank = () => ({ id: BLANK, rank: 0, suit: '?', faceUp: false });
  const isBlank = (card) => !!card && card.id === BLANK;

  /** Every factor, with a short description. Values for them live in model/valuation.json. */
  const FACTORS = {
    // card plays
    home: 'the card goes home (to its foundation)',
    starts_home: 'an Ace goes home, starting its pile',
    opens_column: 'the column the card leaves is now empty',
    fills_column: 'the card goes to an empty column',
    reveals: 'the play uncovers a face-down card (which card is unknown)',
    sets_up_reveal: 'afterwards, a play that would uncover a face-down card is available that was not before',
    new_home_plays: 'plays home that become available (not counting the card just played)',
    new_column_plays: 'plays to a column that become available (not counting the card just played)',
    lost_plays: 'other plays that were available and no longer are',
    promotes: 'a waste play that brings the next waste card into play',
    from_home: 'the card comes back down from home',
    judged_mistake: "the game's ? judgment: an Ace to a column, or a 2 taken off home",
    // the stock
    draw: 'a turn of the stock',
    draw_fraction: 'cards the turn brings up, as a share of the Draw setting (2 of 3 = 0.667)',
    recycles: 'the turn first turns the waste back over (the stock is empty)',
    buries_playable: 'the turn covers a waste card that could be played',
  };

  /** The position as the player sees it: stock and face-down column cards replaced by blanks. */
  function visible(state) {
    const s = JSON.parse(JSON.stringify(state));
    s.stock = s.stock.map(blank);
    s.tableau = s.tableau.map((col) => col.map((c) => (c.faceUp ? c : blank())));
    delete s.deck;
    return s;
  }

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

  /** Card plays in a visible position, as { key, from, to }. */
  function cardPlays(v) {
    return G.legalMoves(v).map((m) => ({ key: moveKey(v, m), from: m.from, to: m.to, pointless: isPointless(v, m) }));
  }

  /** Apply a move to a visible position, keeping any card it uncovers face down (unknown). */
  function applyVisible(v, m) {
    const next = G.move(v, m.from, m.to);
    if (!next) return null;
    if (m.from.pile === 'tableau') {
      const t = top(next.tableau[m.from.index]);
      if (isBlank(t)) t.faceUp = false;
    }
    return next;
  }

  /** True when a play in this position would uncover a face-down card. */
  const uncovers = (v, m) => m.from.pile === 'tableau' && m.from.cardIndex > 0 &&
    !v.tableau[m.from.index][m.from.cardIndex - 1].faceUp;

  function cardPlayFactors(v, play, before) {
    const f = {};
    const moved = G.pickUp(v, play.from).map((c) => c.id);
    const card = G.pickUp(v, play.from)[0];
    const after = applyVisible(v, play);
    const toHome = play.to.pile === 'foundation';
    if (toHome) f.home = 1;
    if (toHome && card.rank === 1) f.starts_home = 1;
    if (play.from.pile === 'foundation') f.from_home = 1;
    if (G.judgeMove(card, play.from.pile, play.to.pile) === '?') f.judged_mistake = 1;
    if (play.from.pile === 'tableau' && after.tableau[play.from.index].length === 0) f.opens_column = 1;
    if (play.to.pile === 'tableau' && v.tableau[play.to.index].length === 0) f.fills_column = 1;
    if (play.from.pile === 'tableau' && isBlank(top(after.tableau[play.from.index]))) f.reveals = 1;
    if (play.from.pile === 'waste' && after.waste.length) f.promotes = 1;

    const beforeKeys = new Set(before.map((p) => p.key));
    const afterPlays = cardPlays(after).filter((p) => !p.pointless);
    const afterKeys = new Set(afterPlays.map((p) => p.key));
    const isMovedCard = (p) => moved.includes(p.key.slice(0, 2));
    let newHome = 0, newColumn = 0, setsUpReveal = 0;
    for (const p of afterPlays) {
      if (beforeKeys.has(p.key) || isMovedCard(p) || p.from.pile === 'foundation') continue;
      if (p.to.pile === 'foundation') newHome++;
      else newColumn++;
      if (uncovers(after, p)) setsUpReveal = 1;
    }
    if (newHome) f.new_home_plays = newHome;
    if (newColumn) f.new_column_plays = newColumn;
    if (setsUpReveal) f.sets_up_reveal = 1;
    const lost = before.filter((p) => p.key !== play.key && !p.pointless && p.from.pile !== 'foundation' &&
      !moved.includes(p.key.slice(0, 2)) && !afterKeys.has(p.key)).length;
    if (lost) f.lost_plays = lost;
    return f;
  }

  function drawFactors(v, before) {
    const f = { draw: 1 };
    const fromStock = v.stock.length > 0;
    const n = Math.min(G.drawOf(v), fromStock ? v.stock.length : v.waste.length);
    f.draw_fraction = Math.round((n / G.drawOf(v)) * 1000) / 1000;
    if (!fromStock) f.recycles = 1;
    if (before.some((p) => p.from.pile === 'waste')) f.buries_playable = 1;
    return f;
  }

  /**
   * Every play in a position with its factors: [{ key, text, kind: 'move' | 'draw', from?, to?,
   * factors }]. Moves that change nothing (a run that already starts a column, to another empty
   * column) are left out. Works on the real state; hidden cards are blanked first.
   */
  function plays(state) {
    if (!state || state.pending) return [];
    const v = visible(state);
    const before = cardPlays(v).filter((p) => !p.pointless);
    const out = before.map((p) => ({
      key: p.key, text: keyText(p.key), kind: 'move', from: p.from, to: p.to,
      factors: cardPlayFactors(v, p, before),
    }));
    if (G.hasHiddenWaste(state)) out.push({ key: 's', text: 's', kind: 'draw', factors: drawFactors(v, before) });
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

  /** One-line text of a description: "s2 w[3S AH 2S]+0 | a: AS | b: ##4H | h: -- --". */
  function describeText(d) {
    const cols = d.cols.map((c, i) => `${G.COLUMN_LETTERS[i]}: ${'#'.repeat(c.down)}${c.up.join(' ') || (c.down ? '' : '--')}`);
    return `s${d.stock} w[${d.waste.join(' ')}]+${d.under} | ${cols.join(' | ')} | h: ${d.home.map((x) => x || '--').join(' ')}`;
  }

  /** The key of the play that takes `prev` to the position after a move from `from` to `to`. */
  const keyOfMove = (prev, from, to) => moveKey(prev, { from, to });

  return { FACTORS, BLANK, visible, plays, keyText, keyOfMove, moveKey, describe, describeText };
});
