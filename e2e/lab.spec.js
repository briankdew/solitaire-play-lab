// Think aloud: recording a game through server.py, notes, undo, Claude's questions and replay.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, openApp, pickShuffle, deal, settle, card, recordText } = require('./helpers');
const { readEvents, replay } = require('../lab/log.js');

const DATA = path.join(__dirname, '..', '.lab-test-data');   // server.py --data in playwright.config.js
const SCREENSHOT_DEAL = 13;   // Custom shuffle row: 4223 deal 1, the opening in the screenshot

async function gameFile(page) {
  const id = await page.locator('#lab').getAttribute('data-game');
  return path.join(DATA, 'games', `${id}.jsonl`);
}
/** The game's log once it has at least `count` events (the page sends them one after another). */
async function eventsOf(page, count) {
  const file = await gameFile(page);
  await expect.poll(() => (fs.existsSync(file) ? readEvents(file).length : 0)).toBeGreaterThanOrEqual(count);
  return readEvents(file);
}
const stock = (page) => page.locator('.slot.stock');

test.describe('think aloud', () => {
  test('records the deal and each play with the plays available, the note and think time', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#labStatus')).toHaveText('Ready to record');
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    await expect(page.locator('#labStatus')).toHaveText('Recording');
    await page.locator('#labNote').fill('Starts the spade pile and opens column a');
    await card(page, 'AS').click();
    await settle(page);
    await expect(page.locator('#labNote')).toHaveValue('');

    const [dealt, first] = await eventsOf(page, 2);
    expect(dealt.type).toBe('deal');
    expect(dealt.setup).toBe('4223');
    expect(dealt.deck.join(' ')).toBe('AS 3H 4H 3S AH 2S 4S 2H');
    expect(dealt.plays.map((p) => p.key).sort()).toEqual(['ASh', 's']);
    expect(dealt.scores).toBeUndefined();

    expect(first).toMatchObject({
      type: 'move', n: 1, move_no: 1, key: 'ASh', text: 'A♠h', token: 'ASh--a',
      choices: 2, note: 'Starts the spade pile and opens column a',
    });
    expect(first.plays).toEqual([{ key: 'ASh', text: 'A♠h' }, { key: 's', text: 's' }]);
    expect(first.pick).toBeUndefined();
    expect(first.think_ms).toBeGreaterThanOrEqual(0);
    expect(first.view).toEqual({ stock: 2, waste: ['3S', 'AH', '2S'], under: 0, cols: [{ down: 0, up: ['AS'] }, { down: 1, up: ['4H'] }], home: [null, null] });
  });

  test('undo, a turn of the stock, a reveal and a win are recorded, and the log replays to the win', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    for (const id of ['AS', '2S']) { await card(page, id).click(); await settle(page); }
    await page.locator('#undoBtn').click();          // take back 2♠h …
    await settle(page);
    await page.locator('#labNote').fill('Thought again: 2♠ home is still best');
    await card(page, '2S').click();                    // … and play it again
    await settle(page);
    for (const id of ['AH', '3S', '4H']) { await card(page, id).click(); await settle(page); }
    await stock(page).click();                         // the last two stock cards: 4♠, then 2♥ on top
    await settle(page);
    for (const id of ['2H', '3H', '4S']) { await card(page, id).click(); await settle(page); }
    await expect(page.locator('#winPanel')).toBeVisible();   // 4♥h comes home by itself

    const events = await eventsOf(page, 14);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('deal');
    expect(types).toContain('undo');
    expect(types[types.length - 1]).toBe('end');
    const undo = events.find((e) => e.type === 'undo');
    expect(undo.undoes).toBe(2);
    const replayed = events.find((e) => e.type === 'move' && e.key === '2Sh' && e.n === 3);
    expect(replayed.note).toBe('Thought again: 2♠ home is still best');
    expect(replayed.move_no).toBe(2);
    expect(events.find((e) => e.key === '4Ha').revealed).toBe('3H');
    expect(events.find((e) => e.type === 'turn')).toMatchObject({ key: 's', turned: ['4S', '2H'] });
    expect(events.find((e) => e.key === '4Hh')).toMatchObject({ auto: true });
    expect(events[events.length - 1]).toMatchObject({ result: 'W', moves: 9 });

    const r = replay(events);
    expect(r.won).toBe(true);
    expect(r.steps.map((s) => s.action.key).join(' ')).toBe('ASh 2Sh AHh 3Sh 4Ha s 2Hh 3Hh 4Sh 4Hh');
  });

  test("Claude's question shows in the panel, and the answer is saved", async ({ page }) => {
    const live = path.join(DATA, 'live');
    fs.mkdirSync(live, { recursive: true });
    const id = `q-${Date.now()}`;
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    const game = path.basename(await gameFile(page), '.jsonl');
    fs.writeFileSync(path.join(live, 'question.json'), JSON.stringify({ id, game, n: 1, play: 'A♠h', text: 'Why A♠h before turning the stock?' }));
    await expect(page.locator('#labQText')).toHaveText('Why A♠h before turning the stock?', { timeout: 6000 });
    await expect(page.locator('#labQMove')).toHaveText('about action 1 (A♠h)');
    await page.locator('#labAnswer').fill('It costs nothing and opens a column.');
    await page.locator('#labAnswerSend').click();
    await expect(page.locator('#labQuestion')).toBeHidden();

    const answers = readEvents(path.join(live, 'answers.jsonl')).filter((a) => a.question_id === id);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ game, n: 1, text: 'It costs nothing and opens a column.' });
    expect(JSON.parse(fs.readFileSync(path.join(live, 'question.json'), 'utf8')).answered).toBeTruthy();
    const logged = (await eventsOf(page, 2)).filter((e) => e.type === 'answer');
    expect(logged[0]).toMatchObject({ question_id: id, text: 'It costs nothing and opens a column.' });
  });

  test('Ctrl+Z in a note box edits the note and leaves the game alone', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    await card(page, 'AS').click();
    await settle(page);
    await page.locator('#labNote').fill('typo');
    await page.locator('#labNote').press('Control+z');
    await expect(page.locator('#labNote')).toHaveValue('');
    await expect(page.locator('#undoBtn')).toBeEnabled();   // the move A♠h still stands
    expect(await recordText(page)).toContain('h');
  });
});
