import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSample, reopenRecentProject } from './startup';

test('places, moves, saves and opens the chosen distribution board from the floor plan', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  const placeBoard = page.getByRole('button', { name:'Elosztó elhelyezése', exact:true });
  await expect(placeBoard).toBeVisible();
  await expect(placeBoard).toHaveAttribute('title', 'Elosztó elhelyezése');
  await expect(placeBoard).toHaveText('');
  await expect(placeBoard).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  page.once('dialog', dialog => dialog.accept('Műhely elosztó'));
  await page.getByRole('button', { name:'Új elosztó', exact:true }).click();
  await page.locator('.view-tabs').getByRole('button', { name:'Alaprajz', exact:true }).click();
  await placeBoard.click();
  await expect(placeBoard).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Elhelyezendő elosztó', { exact:true }).selectOption({ label:'Műhely elosztó' });
  await page.locator('.floor-svg').click({ position:{x:420,y:300} });
  const marker = page.getByRole('button', { name:'Elosztó megnyitása: Műhely elosztó' });
  await expect(marker).toBeVisible();
  const initial = await marker.getAttribute('transform');
  const box = await marker.boundingBox();
  if (!box) throw new Error('Board marker missing');
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45, box.y + 55, {steps:5});
  await page.mouse.up();
  await expect(marker).toBeVisible();
  await expect(marker).not.toHaveAttribute('transform', initial!);
  await page.reload();
  await reopenRecentProject(page);
  await expect(marker).toBeVisible();
  await page.getByRole('button', { name:'Mentés és export', exact:true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name:/PDF a megrendelőnek/ }).click();
  const pdfFile = testInfo.outputPath('floor-board.pdf');
  await (await download).saveAs(pdfFile);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  const loading = getDocument({ data:new Uint8Array(await readFile(pdfFile)), useSystemFonts:true });
  const pdf = await loading.promise;
  try {
    const content = await (await pdf.getPage(1)).getTextContent();
    expect(content.items.map(item => 'str' in item ? item.str : '').join(' ')).toContain('Műhely elosztó');
  } finally { await loading.destroy(); }
  await marker.click();
  await expect(page.getByLabel('Aktív elosztó', { exact:true }).locator('option:checked')).toHaveText('Műhely elosztó');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name:'Elosztó törlése', exact:true }).click();
  await page.locator('.view-tabs').getByRole('button', { name:'Alaprajz', exact:true }).click();
  await expect(marker).toHaveCount(0);
});

test('opens a floor-plan board with the keyboard', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  await page.getByRole('button', { name:'Elosztó elhelyezése', exact:true }).click();
  const boardName = await page.getByLabel('Elhelyezendő elosztó').locator('option:checked').textContent();
  await page.locator('.floor-svg').click({ position:{x:400,y:250} });
  const marker = page.getByRole('button', { name:`Elosztó megnyitása: ${boardName}` });
  await marker.focus(); await marker.press('Enter');
  await expect(page.getByLabel('Aktív elosztó', {exact:true}).locator('option:checked')).toHaveText(boardName!);
});

test('opens a board marker with a touch tap', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch:true, isMobile:true, viewport:{width:320,height:844} });
  const page = await context.newPage();
  await page.goto('/'); await chooseSample(page);
  await expect(page.getByRole('button', { name:'Elosztó elhelyezése', exact:true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name:'Elosztó elhelyezése', exact:true }).tap();
  const boardName = await page.getByLabel('Elhelyezendő elosztó').locator('option:checked').textContent();
  await page.locator('.floor-svg').tap({ position:{x:180,y:160} });
  const marker = page.getByRole('button', { name:`Elosztó megnyitása: ${boardName}` });
  await expect(marker).toBeVisible();
  await marker.tap();
  await expect(page.getByLabel('Aktív elosztó', {exact:true}).locator('option:checked')).toHaveText(boardName!);
  await context.close();
});
