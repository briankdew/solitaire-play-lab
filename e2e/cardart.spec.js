// Card art: importing SVG card faces and backs, choosing them independently, and removing them.
const { test, expect, openApp } = require('./helpers');

const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 250 350"><rect width="250" height="350" fill="${fill}"/></svg>`);
const file = (name, buffer) => ({ name, mimeType: 'image/svg+xml', buffer });

test('card faces and backs import from SVG files, are chosen separately, and can be removed', async ({ page }) => {
  const answers = [];
  page.on('dialog', (d) => d.accept(answers.shift()));
  await openApp(page);   // 3223: A–3 in ♠ ♥

  // File names say which card: compact (AS) and words (2_of_hearts); a joker isn't a card here.
  const ids = await page.evaluate(async () => {
    const m = await import('/ui/cardart.js');
    return ['AS.svg', '10h.svg', 'th.svg', 'ace_of_spades.svg', 'jack_of_spades2.svg', 'king-clubs.svg', 's1.svg', 'spade_13.svg', 'red_joker.svg', 'back.svg']
      .map((n) => m.cardIdOf(n));
  });
  expect(ids).toEqual(['AS', 'XH', 'XH', 'AS', 'JS', 'KC', 'AS', 'KS', null, null]);

  answers.push('Test faces');
  await page.locator('#faceArtFile').setInputFiles([file('AS.svg', svg('#3a7')), file('2_of_hearts.svg', svg('#a37')), file('red_joker.svg', svg('#000'))]);
  await expect(page.locator('#status')).toContainText('Imported 2 card faces as "Test faces"');
  await expect(page.locator('#status')).toContainText('skipped 1');
  await expect(page.locator('#faceArtSel')).toHaveValue('Test faces');
  await expect(page.locator('.card[data-id="AS"] .face.art img')).toHaveAttribute('src', '/cardart/faces/Test%20faces/AS.svg');
  await expect(page.locator('.card[data-id="2H"] .face.art img')).toHaveCount(1);
  await expect(page.locator('.card[data-id="3H"] .face.art')).toHaveCount(0);   // not in the set: built-in face

  answers.push('Green');
  await page.locator('#backArtFile').setInputFiles([file('green back.svg', svg('#0a0'))]);
  await expect(page.locator('#backArtSel')).toHaveValue('Green');
  await expect(page.locator('.table-wrap')).toHaveAttribute('data-back-art', '');

  // Faces and backs are independent: back to built-in faces, the back stays.
  await page.locator('#faceArtSel').selectOption('');
  await expect(page.locator('.face.art')).toHaveCount(0);
  await expect(page.locator('.table-wrap')).toHaveAttribute('data-back-art', '');

  // The choice is remembered on reload.
  await page.reload();
  await expect(page.locator('#backArtSel')).toHaveValue('Green');
  await expect(page.locator('#faceArtSel')).toHaveValue('');

  // A file that isn't SVG is refused.
  await page.locator('#backArtFile').setInputFiles([file('broken.svg', Buffer.from('not an svg'))]);
  await expect(page.locator('#status')).toContainText('Could not import broken.svg');

  answers.push(undefined);   // confirm Remove (OK)
  await page.locator('#backArtRemove').click();
  await expect(page.locator('#status')).toContainText('Removed "Green"');
  await expect(page.locator('#backArtSel option')).toHaveCount(1);
  await expect(page.locator('.table-wrap')).not.toHaveAttribute('data-back-art', '');
});
