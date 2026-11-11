import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

// Playwright hides native scrollbars by default. Enable them here so geometry,
// mouse dragging and screenshots exercise the controls the user actually sees.
test.use({ launchOptions: {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  ignoreDefaultArgs: ['--hide-scrollbars'],
} });

test('both native scrollbars are reachable at the visible edges and support dragging and keyboard', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  const cards = page.locator('.circuit-cards');
  const dimensions = await cards.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const area = element.closest('.editor-area')!.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      hBar: element.offsetHeight - element.clientHeight, vBar: element.offsetWidth - element.clientWidth,
      widthOverflow: element.scrollWidth - element.clientWidth, heightOverflow: element.scrollHeight - element.clientHeight,
      rightGap: area.right - rect.right, bottomGap: area.bottom - rect.bottom };
  });
  expect(dimensions.widthOverflow).toBeGreaterThan(0);
  expect(dimensions.heightOverflow).toBeGreaterThan(0);
  expect(dimensions.hBar).toBeGreaterThan(0);
  expect(dimensions.vBar).toBeGreaterThan(0);
  expect(Math.abs(dimensions.bottomGap)).toBeLessThanOrEqual(1);
  expect(Math.abs(dimensions.rightGap)).toBeLessThanOrEqual(1);
  expect(dimensions.y + dimensions.height).toBeLessThanOrEqual((await page.locator('.statusbar').boundingBox())!.y + 1);
  await page.screenshot({ path: 'tmp/circuit-visible-scrollbars.png' });

  // Drag the native horizontal thumb without first moving vertically.
  const scrollbarY = dimensions.y + dimensions.height - dimensions.hBar / 2;
  await page.mouse.move(dimensions.x + 40, scrollbarY);
  await page.mouse.down();
  await page.mouse.move(dimensions.x + dimensions.width - dimensions.vBar - 10, scrollbarY, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => cards.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBe(0);

  // Drag the native vertical thumb from the right edge and then use keys.
  const scrollbarX = dimensions.x + dimensions.width - dimensions.vBar / 2;
  await page.mouse.move(scrollbarX, dimensions.y + 40);
  await page.mouse.down();
  await page.mouse.move(scrollbarX, dimensions.y + dimensions.height - dimensions.hBar - 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await cards.focus();
  await page.keyboard.press('Control+Home');
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBe(0);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await cards.evaluate(element => { element.scrollLeft = 0; });
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => cards.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
});

test('keeps the add action usable after removing the last circuit', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  for (const code of ['ÁK1', 'ÁK2', 'ÁK3']) {
    await page.getByRole('button', { name: `${code} törlése`, exact: true }).click();
  }
  await expect(page.getByText('Még nincs áramkör')).toBeVisible();
  await page.getByRole('button', { name: 'Új áramkör', exact: true }).click();
  await expect(page.getByLabel('ÁK1 neve', { exact: true })).toBeFocused();
  await expect(page.getByLabel('ÁK1 neve', { exact: true })).toBeInViewport();
});
