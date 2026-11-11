import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSample, reopenRecentProject } from './startup';

async function assign(page: Page, reference: string) {
  await page.getByRole('button', { name: 'Gyártói termék kiválasztása', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
  await dialog.getByRole('searchbox').fill(reference);
  const card = dialog.locator('.product-card').filter({ has: page.locator('.product-reference', { hasText: reference }) });
  await expect(card).toHaveCount(1);
  const image = await card.locator('img').getAttribute('src');
  expect(image).toMatch(/^data:image\/webp;base64,/);
  await card.getByRole('button', { name: `Hozzárendelés az eszközhöz: ${reference}`, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return image!;
}

test('uses the selected manufacturer picture in the plan and PDF, while a custom picture takes precedence', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  const device = page.getByRole('button', { name: 'K1, Kapcsoló', exact: true });
  await device.locator('circle').first().click();
  const first = await assign(page, 'EPH0100171');
  await page.getByRole('button', { name: 'Valós képek', exact: true }).click();
  const planImage = device.getByTestId('floor-device-image');
  await expect(planImage).toHaveAttribute('href', first);
  await expect(page.locator('.plan-image-preview img')).toHaveAttribute('src', first);
  const second = await assign(page, 'EPH0100121');
  expect(second).not.toBe(first);
  await expect(planImage).toHaveAttribute('href', second);

  // Verify an actual embedded PDF image against opaque pixels of the selected
  // manufacturer photo, rather than only checking for any image in the PDF.
  const source = await page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const samples: { index: number; rgb: number[] }[] = [];
    for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) {
      const offset = (Math.floor(y * canvas.height / 10) * canvas.width + Math.floor(x * canvas.width / 10)) * 4;
      if (data[offset + 3] === 255) samples.push({ index: offset / 4, rgb: Array.from(data.slice(offset, offset + 3)) });
    }
    return { width: canvas.width, height: canvas.height, samples };
  }, second);
  expect(source.samples.length).toBeGreaterThan(5);
  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /PDF a megrendelőnek/ }).click();
  const pdfPath = testInfo.outputPath('manufacturer-floor.pdf');
  await (await downloading).saveAs(pdfPath);
  const pdf = getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true });
  try {
    const document = await pdf.promise, sheet = await document.getPage(1), operators = await sheet.getOperatorList();
    const pictures = operators.fnArray.flatMap((operator, index) => operator === OPS.paintImageXObject ? [sheet.objs.get(operators.argsArray[index][0])] : []);
    const match = pictures.find(picture => {
      if (picture.width !== source.width || picture.height !== source.height) return false;
      const channels = picture.kind === 3 ? 4 : 3;
      return source.samples.every(sample => sample.rgb.every((value, channel) => Math.abs(picture.data[sample.index * channels + channel] - value) <= 3));
    });
    expect(match).toBeTruthy();
  } finally { await pdf.destroy(); }

  const custom = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
    const context = canvas.getContext('2d')!; context.fillStyle = '#d93029'; context.fillRect(0, 0, 20, 20);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Alaprajzi kép feltöltése', { exact: true }).setInputFiles({ name: 'sajat.png', mimeType: 'image/png', buffer: Buffer.from(custom, 'base64') });
  await expect(planImage).toHaveAttribute('href', /^data:image\/png;base64,/);
  await assign(page, 'EPH0100171');
  await expect(planImage).toHaveAttribute('href', /^data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Alaprajzi kép eltávolítása', exact: true }).click();
  await expect(planImage).toHaveAttribute('href', first);
  await page.reload(); await reopenRecentProject(page);
  await expect(page.getByRole('button', { name: 'K1, Kapcsoló', exact: true }).getByTestId('floor-device-image')).toHaveAttribute('href', first);
});

test('reopens an already assigned manufacturer picture completely offline', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('http://localhost:4173/');
  await chooseSample(page);
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'K1, Kapcsoló', exact: true }).locator('circle').first().click();
  const image = await assign(page, 'EPH0100171');
  await page.getByRole('button', { name: 'Valós képek', exact: true }).click();
  await expect(page.getByRole('button', { name: 'K1, Kapcsoló', exact: true }).getByTestId('floor-device-image')).toHaveAttribute('href', image);
  await page.reload(); await reopenRecentProject(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload(); await reopenRecentProject(page);
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'K1, Kapcsoló', exact: true }).getByTestId('floor-device-image')).toHaveAttribute('href', image);
});
