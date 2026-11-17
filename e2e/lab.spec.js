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
/** Played shuffle's list once its newest load has shown (typing a search reloads it after a pause). */
const listReady = (page) => expect(page.locator('#replayList')).toHaveAttribute('aria-busy', 'false');

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

  test('the reason-code menu adds a code at the cursor and shows its definition; the note goes with the next play', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    const menu = page.locator('#labCode');
    await expect(menu.locator('option[value="NNP"]')).toHaveCount(1);   // the adopted codes, from catalog/reasons.json, NNP pinned once
    await expect(menu.locator('option[value="most_hidden"]')).toHaveCount(1);
    await expect(menu.locator('option[value="new_play"]')).toHaveCount(0);   // retired codes aren't offered
    expect(await menu.locator('option[value="ONP"]').getAttribute('title')).toMatch(/freshly available/);   // hover shows the definition
    await menu.selectOption('ONP');
    await expect(page.locator('#labNote')).toHaveValue('ONP');
    await expect(page.locator('#labCodeDef')).toContainText('ONP: ');
    await expect(menu).toHaveValue('');
    await stock(page).click();
    await settle(page);
    await expect(page.locator('#labCodeDef')).toBeHidden();
    await page.locator('#labNote').fill('nothing new');
    await page.locator('#labNote').evaluate((t) => t.setSelectionRange(0, 0));
    await menu.selectOption('NNP');
    await expect(page.locator('#labNote')).toHaveValue('NNP nothing new');   // at the cursor, with a space
    await stock(page).click();
    await settle(page);
    const turns = (await eventsOf(page, 3)).filter((e) => e.type === 'turn');
    expect(turns.map((e) => e.note)).toEqual(['ONP', 'NNP nothing new']);
  });

  test('the suit buttons put a suit at the cursor of their box, which keeps the focus', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    const note = page.locator('#labNote');
    await note.fill('Ah first');
    await note.evaluate((t) => t.setSelectionRange(1, 1));
    await page.locator('.lab-suits[data-for="labNote"] button[data-suit="♦"]').click();
    await expect(note).toHaveValue('A♦h first');
    await expect(note).toBeFocused();
    await page.locator('.lab-suits[data-for="labNote"] button[data-suit="♠"]').click();
    await expect(note).toHaveValue('A♦♠h first');   // still at the cursor, after the first suit
  });

  test('Undo puts the undone play\'s note back in the note box, for the play made instead', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    await page.locator('#labNote').fill('only play');
    await stock(page).click();                         // a misclick on the stock …
    await settle(page);
    await expect(page.locator('#labNote')).toHaveValue('');
    await page.locator('#undoBtn').click();
    await settle(page);
    await expect(page.locator('#labNote')).toHaveValue('only play');
    await card(page, 'AS').click();                    // … and the play meant
    await settle(page);
    const events = await eventsOf(page, 4);
    expect(events.find((e) => e.type === 'move')).toMatchObject({ key: 'ASh', note: 'only play' });
  });

  test('a note typed before Undo stays in the box and goes with the next play', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    await stock(page).click();
    await settle(page);
    await page.locator('#labNote').fill('Open column a to make room');
    await page.locator('#undoBtn').click();
    await settle(page);
    await expect(page.locator('#labNote')).toHaveValue('Open column a to make room');
    await card(page, 'AS').click();
    await settle(page);
    const events = await eventsOf(page, 4);
    expect(events.find((e) => e.type === 'undo').note).toBeUndefined();
    expect(events.find((e) => e.type === 'move')).toMatchObject({ key: 'ASh', note: 'Open column a to make room' });
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
    await card(page, 'AS').click();
    await settle(page);
    const game = path.basename(await gameFile(page), '.jsonl');
    fs.writeFileSync(path.join(live, 'question.json'), JSON.stringify({ id, game, n: 1, play: 'A♠h', text: 'Why A♠h before turning the stock?' }));
    await expect(page.locator('#labQText')).toHaveText('Why A♠h before turning the stock?', { timeout: 6000 });
    await expect(page.locator('#labQMove')).toHaveText('about #001, before you played A♠h');
    await expect(page.locator('#steps .step.asked')).toHaveAttribute('data-seq', '1');   // its line is highlighted
    await page.locator('#labAnswer').fill('It costs nothing and opens a column.');
    await page.locator('#labAnswerSend').click();
    await expect(page.locator('#labQuestion')).toBeHidden();
    await expect(page.locator('#steps .step.asked')).toHaveCount(0);

    const answers = readEvents(path.join(live, 'answers.jsonl')).filter((a) => a.question_id === id);
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ game, n: 1, text: 'It costs nothing and opens a column.' });
    expect(JSON.parse(fs.readFileSync(path.join(live, 'question.json'), 'utf8')).answered).toBeTruthy();
    const logged = (await eventsOf(page, 3)).filter((e) => e.type === 'answer');
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

test.describe('played shuffles', () => {
  test('a dealt shuffle gets an ID, is listed, and Replay deals it again under the same ID', async ({ page }) => {
    await openApp(page);
    await pickShuffle(page, SCREENSHOT_DEAL);
    await deal(page);
    const shuffleLine = page.locator('#labShuffle');
    await expect(shuffleLine).toBeVisible();
    const id = (await shuffleLine.locator('b').textContent()).trim();
    expect(id).toMatch(/^4223-\d{6}-[0-9a-f]{12}$/);
    await card(page, 'AS').click();
    await settle(page);

    await page.locator('#replayBtn').click();
    await expect(page.locator('#replayModal')).toBeVisible();
    await expect(page.locator('#replaySetup')).toHaveValue('4223');
    const counter = String(Number(id.split('-')[1]));
    await page.locator('#replaySearch').fill(counter);
    await listReady(page);
    const row = page.locator('.replay-row').filter({ hasText: id });
    await expect(row).toHaveCount(1);
    await expect(page.locator('#replayList')).not.toContainText('AS');   // no cards in the list
    await row.getByRole('button', { name: 'New game' }).click();
    await page.locator('#confirmContinue').click();   // a game is in play: confirm ending it
    await settle(page);
    await expect(page.locator('#replayModal')).toBeHidden();
    await expect(shuffleLine.locator('b')).toHaveText(id);
    await expect(shuffleLine).toContainText('game');
    await expect(card(page, 'AS')).toBeVisible();

    const events = await eventsOf(page, 1);
    expect(events[0]).toMatchObject({ type: 'deal', shuffle: id, first_deal: false });
  });

  test('Replay steps through a finished game in a new tab, skipping undone actions and recording nothing', async ({ page }) => {
    await openApp(page, { seed: 6161 });
    await page.locator('#highestSel').selectOption('9');   // its own shuffle: no other test deals it
    await deal(page);
    const id = (await page.locator('#labShuffle b').textContent()).trim();
    await stock(page).click();
    await settle(page);
    await page.keyboard.press('Control+z');   // taken back: Replay skips it
    await settle(page);
    await page.locator('#labNote').fill('Nothing to play yet');
    await stock(page).click();
    await settle(page);
    await page.locator('#endGameBtn').click();
    const logged = (await eventsOf(page, 5)).length;   // deal, turn, undo, turn, end

    await page.locator('#replayBtn').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    const row = page.locator('.replay-row').filter({ hasText: id });
    const [tab] = await Promise.all([page.context().waitForEvent('page'), row.getByRole('button', { name: 'Replay' }).click()]);
    await expect(tab.locator('#study')).toBeVisible();
    await expect(tab.locator('#lab')).toBeHidden();
    await expect(tab.locator('.study-list li')).toHaveCount(2);   // the draw that stood, then the end
    await expect(tab.locator('.study-now')).toContainText('#2 draw (s)');
    await expect(tab.locator('.study-now')).toContainText('Nothing to play yet');
    await tab.keyboard.press('ArrowRight');
    await expect(tab.locator('.study-now')).toContainText('Lost');
    await tab.locator('.study-list li').first().click();
    await expect(tab.locator('.study-now')).toContainText('#2 draw (s)');
    await tab.close();
    expect(readEvents(await gameFile(page)).length).toBe(logged);   // nothing recorded
    await page.locator('#replayClose').click();
  });

  test('Review is off until a game of the shuffle is finished, then copies /review and the game ID', async ({ page }) => {
    await openApp(page, { seed: 5151 });
    await page.locator('#highestSel').selectOption('9');
    await deal(page);
    const id = (await page.locator('#labShuffle b').textContent()).trim();
    const openRow = async () => {
      await page.locator('#replayBtn').click();
      await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
      await listReady(page);
      return page.locator('.replay-row').filter({ hasText: id });
    };
    let row = await openRow();
    await expect(row.getByRole('button', { name: 'Review' })).toBeDisabled();   // still in play
    await page.locator('#replayClose').click();

    await page.locator('#endGameBtn').click();
    const events = await eventsOf(page, 2);
    expect(events[events.length - 1]).toMatchObject({ type: 'end', result: 'L' });
    row = await openRow();
    await expect(row).toContainText('not reviewed');
    await row.getByRole('button', { name: 'Review' }).click();
    await expect(page.locator('#replayCount')).toContainText(/\/review 9\S+/);
    await page.locator('#replayClose').click();
    // Once /review has written the game's summary, the row says so.
    const game = await page.locator('#lab').getAttribute('data-game');
    fs.writeFileSync(path.join(DATA, 'catalog', 'reviews', `${game}.md`), '# Review\n');
    row = await openRow();
    await expect(row).toContainText(/· reviewed/);
    await page.locator('#replayClose').click();
  });
});

test.describe('exploratory games and deleting', () => {
  test('the Exploratory switch marks the game, including a switch mid-game, and lists it apart', async ({ page }) => {
    await openApp(page, { seed: 4242 });
    await page.evaluate(() => localStorage.removeItem('solitaire-play-lab.exploratory'));
    await page.locator('#highestSel').selectOption('9');   // an 18-card deck: no other test deals the same shuffle
    await deal(page);
    const id = (await page.locator('#labShuffle b').textContent()).trim();
    await page.locator('#labExplore').check();
    await expect(page.locator('#lab')).toHaveClass(/exploring/);
    await page.locator('#endGameBtn').click();
    const events = await eventsOf(page, 3);
    expect(events[0].exploratory).toBe(false);
    expect(events.find((e) => e.type === 'mark')).toMatchObject({ exploratory: true });
    expect(events[events.length - 1]).toMatchObject({ type: 'end', result: 'L', exploratory: true });

    await page.locator('#replayBtn').click();
    await page.locator('.replay-tab[data-kind="exploratory"]').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    await expect(page.locator('.replay-row').filter({ hasText: id })).toContainText('1 exploratory game');
    await page.locator('.replay-tab[data-kind="method"]').click();
    await expect(page.locator('.replay-row').filter({ hasText: id })).toHaveCount(0);
    await page.locator('#replayClose').click();
    await page.locator('#labExplore').uncheck();
  });

  test('Delete asks first, moves the shuffle to Deleted, and Restore brings it back', async ({ page }) => {
    await openApp(page, { seed: 777 });
    await page.evaluate(() => localStorage.removeItem('solitaire-play-lab.exploratory'));
    await page.locator('#highestSel').selectOption('9');   // an 18-card deck: no other test deals the same shuffle
    await deal(page);
    const id = (await page.locator('#labShuffle b').textContent()).trim();
    const file = await gameFile(page);
    await page.locator('#replayBtn').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    const row = page.locator('.replay-row').filter({ hasText: id });
    await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();   // being played
    await page.locator('#replayClose').click();
    await page.locator('#endGameBtn').click();
    await expect.poll(() => readEvents(file).some((e) => e.type === 'end')).toBe(true);

    await page.locator('#replayBtn').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toContainText('Delete it and its 1 game?');
    await row.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#replayCount')).toContainText(`Deleted ${id}`);
    await expect(row).toHaveCount(0);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(path.join(DATA, 'games', 'deleted', id, path.basename(file)))).toBe(true);

    await page.locator('.replay-tab[data-kind="deleted"]').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    await row.getByRole('button', { name: 'Restore' }).click();
    await expect(page.locator('#replayCount')).toContainText(`Restored ${id}`);
    expect(fs.existsSync(file)).toBe(true);
    await page.locator('.replay-tab[data-kind="method"]').click();
    await page.locator('#replaySearch').fill(String(Number(id.split('-')[1])));
    await listReady(page);
    await expect(row).toContainText('lost 1');
  });
});
