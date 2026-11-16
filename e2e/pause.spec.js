// Pause game and Resume: a paused game is rebuilt from its log, record and numbering included.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect, openApp, deal, settle, recordText, seqLines } = require('./helpers');
const { readEvents } = require('../lab/log.js');

const DATA = path.join(__dirname, '..', '.lab-test-data');

test('Pause game stops the game; Played shuffle → Paused resumes it where it was', async ({ page }) => {
  await openApp(page, { seed: 4242 });
  await page.evaluate(() => localStorage.removeItem('solitaire-play-lab.exploratory'));
  await page.locator('#highestSel').selectOption('8');   // a 16-card deck no other test deals
  await deal(page);
  const stock = page.locator('.slot.stock');
  await page.locator('#labNote').fill('first draw');
  await stock.click(); await settle(page);
  await stock.click(); await settle(page);
  await page.locator('#undoBtn').click(); await settle(page);   // a neutral line, #002
  await stock.click(); await settle(page);
  const before = { record: await recordText(page), seq: await seqLines(page) };
  const game = await page.locator('#lab').getAttribute('data-game');
  await expect(page.locator('#pauseGameBtn')).toBeEnabled();
  await page.locator('#pauseGameBtn').click();
  await expect(page.locator('#pauseGameBtn')).toBeDisabled();
  await expect(page.locator('#status')).toContainText('Game paused');
  const file = path.join(DATA, 'games', `${game}.jsonl`);
  await expect.poll(() => readEvents(file).some((e) => e.type === 'pause')).toBe(true);

  // Something else in between: a new shuffle (the paused game isn't marked abandoned).
  await page.locator('#newBtn').click(); await settle(page);
  expect(readEvents(file).some((e) => e.type === 'end')).toBe(false);

  await page.locator('#replayBtn').click();
  await page.locator('.replay-tab[data-kind="paused"]').click();
  await expect(page.locator('#replayList')).toHaveAttribute('aria-busy', 'false');
  const row = page.locator('.replay-row').first();
  await expect(row).toContainText('paused');
  await row.getByRole('button', { name: 'Resume' }).click();
  await expect(page.locator('#status')).toContainText('Game resumed');
  await expect(page.locator('#lab')).toHaveAttribute('data-game', game);   // the same game, same log
  expect(await recordText(page)).toBe(before.record);
  expect(await seqLines(page)).toEqual(before.seq);
  await expect(page.locator('#labShuffle')).toContainText('resumed game');

  await stock.click(); await settle(page);   // play goes on, numbered after the last action
  await expect.poll(() => readEvents(file).filter((e) => e.type === 'turn').map((e) => e.n)).toEqual([1, 2, 3, 4]);
  const events = readEvents(file);
  expect(events.find((e) => e.type === 'resume')).toBeTruthy();
  expect(events.filter((e) => e.type === 'turn')[0].note).toBe('first draw');
});
