import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSample } from './startup';

test('shows the matching enclosure photo on the floor plan and in its PDF', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.manufacturer-library-button').click();
  const library = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár' });
  await library.getByRole('searchbox').fill('EZ9EUD212');
  await library.getByRole('button', { name: 'Elosztó létrehozása: EZ9EUD212' }).click();
  await library.getByRole('button', { name: 'Termékkönyvtár bezárása' }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
  await page.getByRole('button', { name: 'Valós képek', exact: true }).click();

  async function pdfImageCount(page: Page, name: string) {
    await page.getByRole('button', { name:'Mentés és export', exact:true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name:/PDF a megrendelőnek/ }).click();
    const path = testInfo.outputPath(name);
    await (await download).saveAs(path);
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    const loading = getDocument({ data: new Uint8Array(await readFile(path)), useSystemFonts: true });
    const pdf = await loading.promise;
    try {
      const operators = await (await pdf.getPage(1)).getOperatorList();
      return operators.fnArray.filter(code => code === OPS.paintImageXObject || code === OPS.paintInlineImageXObject).length;
    } finally { await loading.destroy(); }
  }
  const before = await pdfImageCount(page, 'before.pdf');
  await page.getByRole('button', { name: 'Elosztó elhelyezése', exact:true }).click();
  const picker = page.getByLabel('Elhelyezendő elosztó');
  const option = picker.locator('option').filter({ hasText: 'EZ9EUD212' });
  await picker.selectOption(await option.getAttribute('value') ?? '');
  await page.locator('.floor-svg').click({ position: { x: 470, y: 330 } });
  const marker = page.locator('.floor-board-marker').filter({ hasText: 'EZ9EUD212' });
  const image = marker.locator('image');
  await expect(image).toHaveCount(1);
  const source = await image.getAttribute('href');
  expect(source).toMatch(/^data:image\/webp;base64,/);
  expect(await page.evaluate(async data => !!(await createImageBitmap(await (await fetch(data)).blob())).width, source!)).toBe(true);
  await page.getByRole('button', { name: 'Rajzjelek', exact: true }).click();
  await expect(marker.locator('image')).toHaveCount(0);
  await page.getByRole('button', { name: 'Valós képek', exact: true }).click();
  await expect(marker.locator('image')).toHaveCount(1);
  expect(await pdfImageCount(page, 'after.pdf')).toBe(before + 1);
});
