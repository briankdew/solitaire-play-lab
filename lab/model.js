/*
 * Play-lab model: the summation valuation. A play's total is the sum of value × factor over its
 * factors (lab/features.js), with the values from model/valuation.json (or model/learned.json).
 *
 * With "draw_baseline": true, every card play also gets the value of the turn of the stock when a
 * turn is available, because the stock can still be turned after the play. This matches the
 * worked example (A♠h = 2.83, s = 0.33); it shifts every card play by the same amount, so it
 * never changes which card play ranks first, only how card plays compare with turning the stock.
 *
 * Works as a browser global (window.LabModel) and as a Node module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LabModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round = (x) => Math.round(x * 1000) / 1000;

  /** Value × factor, summed. */
  function rawScore(factors, values) {
    let total = 0;
    for (const [name, amount] of Object.entries(factors || {})) total += (values[name] || 0) * amount;
    return total;
  }

  /**
   * Scores for a position's plays: { scores: { key: total }, pick: [keys with the top total] }.
   * `valuation` is the parsed model/valuation.json ({ values, draw_baseline }).
   */
  function score(plays, valuation) {
    const values = (valuation && valuation.values) || {};
    const drawPlay = plays.find((p) => p.kind === 'draw');
    const baseline = valuation && valuation.draw_baseline && drawPlay ? rawScore(drawPlay.factors, values) : 0;
    const scores = {};
    for (const p of plays) scores[p.key] = round(rawScore(p.factors, values) + (p.kind === 'draw' ? 0 : baseline));
    const best = Math.max(...Object.values(scores));
    const pick = plays.length ? plays.filter((p) => scores[p.key] === best).map((p) => p.key) : [];
    return { scores, pick };
  }

  return { score, rawScore };
});
