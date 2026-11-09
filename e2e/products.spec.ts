import { chooseSample, reopenRecentProject } from './startup';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ProjectDocument } from '../src/types';

const outputDir = path.resolve('tmp/products-results');
const catalogCount = (JSON.parse(readFileSync(path.resolve('src/products/schneider-source.json'), 'utf8')) as { products: unknown[] }).products.length + 10;
const library = (page: Page) => page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
const findProduct = async (dialog: Locator, reference: string) => {
  await dialog.getByRole('searchbox').fill(reference);
  const card = dialog.locator('.product-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.product-reference')).toHaveText(reference);
  return card;
};

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    if (!id) throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { db.close(); if (!get.result?.document) reject(new Error('Missing active project')); else resolve(get.result.document); };
      };
    });
  });
}

async function openPlanner(page: Page, url = '/') {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto(url);
  await chooseSample(page);
  await expect(page.locator('.manufacturer-library-button')).toBeAttached();
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
}

test.beforeAll(async () => { await mkdir(outputDir, { recursive: true }); });

test('creates a manufacturer enclosure, adds exact module widths and archives accessory quantities with their source', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page);
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText(`${catalogCount} termék`);
  const enclosure = await findProduct(dialog, 'EZ9EUD212');
  await expect(enclosure.locator('.product-specs')).toContainText('2 sor × 12 modul');
  await enclosure.getByRole('button', { name: 'Elosztó létrehozása: EZ9EUD212', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards.some(board => board.product?.reference === 'EZ9EUD212')).toBe(true);
  await expect(dialog).toBeVisible();

  for (const [reference, width] of [['EZ9F57116', 1], ['EZ9A29924', .5], ['EZ9D55716', 5]] as const) {
    const card = await findProduct(dialog, reference);
    await expect(card.locator('.product-specs').getByText(`${width.toLocaleString('hu-HU')} M`, { exact: true })).toBeVisible();
    await expect(card.locator('.product-source')).toContainText('Easy9Pro_catalog_HU');
    await expect(card.getByRole('link', { name: 'Hivatalos gyártói forrás' })).toHaveAttribute('href', /^https:\/\/download\.se\.com\//);
    await card.getByRole('button', { name: `Hozzáadás az elosztóhoz: ${reference}`, exact: true }).click();
    await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.product?.reference === reference)?.moduleWidth).toBe(width);
    await expect(dialog).toBeVisible();
  }
  const accessory = await findProduct(dialog, 'R9XFH112');
  await expect(accessory.locator('.product-specs dt').getByText('Modulszélesség', { exact: true })).toHaveCount(0);
  await accessory.getByRole('button', { name: 'Tartozék hozzáadása: R9XFH112', exact: true }).click();
  await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása', exact: true }).click();
  await expect(page.locator('.din-row')).toHaveCount(2);
  await expect(page.locator('.board-accessories')).toContainText('R9XFH112');
  await page.getByLabel('Mennyiség (db)', { exact: true }).fill('3');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.product?.reference === 'R9XFH112')?.quantity).toBe(3);
  const document = await readDocument(page);
  const board = document.data.boards.find(item => item.product?.reference === 'EZ9EUD212')!;
  expect(board.rows.map(row => row.capacity)).toEqual([12, 12]);
  const placed = board.rows.flatMap(row => row.placements);
  expect(placed).toHaveLength(3);
  expect(placed.reduce((sum, placement) => sum + document.data.devices.find(device => device.id === placement.deviceId)!.moduleWidth!, 0)).toBe(6.5);
  const accessoryDevice = document.data.devices.find(device => device.product?.reference === 'R9XFH112')!;
  expect(accessoryDevice.boardId).toBe(board.id);
  expect(accessoryDevice.moduleWidth).toBeUndefined();
  expect(placed.some(item => item.deviceId === accessoryDevice.id)).toBe(false);
  await expect(page.locator('.board-stats > div').nth(1)).toContainText('6,5');
  await page.screenshot({ path: path.join(outputDir, 'manufacturer-board.png'), fullPage: true });

  await page.getByRole('button', { name: /Mentés és export/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Projektfájl mentése/ }).click();
  const download = await downloadPromise;
  const archive = path.join(outputDir, 'manufacturer-roundtrip.vgecko');
  await download.saveAs(archive);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.getByLabel('Mennyiség (db)', { exact: true }).fill('7');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.id === accessoryDevice.id)?.quantity).toBe(7);
  await page.locator('input[accept*=".vgecko"]').setInputFiles(archive);
  await expect(page.locator('.project-title')).toContainText('importált másolat');
  const imported = await readDocument(page);
  expect(imported.data.id).not.toBe(document.data.id);
  expect(imported.data.devices).toEqual(document.data.devices);
  expect(imported.data.boards).toEqual(document.data.boards);
  expect(imported.data.devices.find(device => device.id === accessoryDevice.id)?.product?.sourcePage).toBeGreaterThan(0);
  await page.getByLabel('Nyelv / Language', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Save and export', exact: true }).click();
  const pdfDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Detailed technical PDF/ }).click();
  const pdfDownload = await pdfDownloadPromise;
  expect(pdfDownload.suggestedFilename()).toMatch(/\.pdf$/);
  await pdfDownload.saveAs('tmp/products-catalog-en.pdf');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('searches and filters the complete offline catalogue, paginates and translates the library', async ({ page }) => {
  await openPlanner(page);
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  await expect(dialog.locator('.product-card')).toHaveCount(40);
  await dialog.getByRole('button', { name: 'További 40 termék', exact: true }).click();
  await expect(dialog.locator('.product-card')).toHaveCount(80);
  await dialog.getByRole('searchbox').fill('kismegszakito');
  await expect(dialog.locator('.product-card').first()).toBeVisible();
  await dialog.getByLabel('Kategória', { exact: true }).selectOption('mcb');
  await dialog.getByLabel('Névleges áram', { exact: true }).selectOption('16');
  await dialog.getByLabel('Pólusszám', { exact: true }).selectOption('1P');
  await expect(dialog.getByRole('status')).toHaveText(new RegExp(`^\\d+ termék / ${catalogCount}$`));
  const resultCount = await dialog.locator('.product-card').count();
  expect(resultCount).toBeGreaterThan(0);
  for (const card of await dialog.locator('.product-card').all()) {
    await expect(card.getByRole('heading')).toContainText('Kismegszakító');
    await expect(card.locator('.product-specs')).toContainText('16 A');
    await expect(card.locator('.product-specs')).toContainText('1P');
  }
  await dialog.getByRole('searchbox').fill('does-not-exist');
  await expect(dialog.getByRole('heading', { name: 'Nincs találat', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Szűrők törlése', exact: true }).first().click();
  await expect(dialog.getByRole('status')).toHaveText(`${catalogCount} termék`);
  const spacer = await findProduct(dialog, 'A9A27062');
  await expect(spacer.locator('.product-specs').getByText('0,5 M', { exact: true })).toBeVisible();
  await expect(spacer.getByRole('link', { name: 'Kiegészítő gyártói adatlap', exact: true })).toHaveAttribute('href', /^https:\/\/(www\.)?se\.com\//);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.manufacturer-library-button')).toBeFocused();
  await page.getByLabel('Nyelv / Language', { exact: true }).selectOption('en');
  await page.locator('.view-tabs').getByRole('button', { name: 'Distribution board', exact: true }).click();
  await page.getByRole('button', { name: /Manufacturer product library/ }).click();
  const english = page.getByRole('dialog', { name: 'Manufacturer product library', exact: true });
  await expect(english.getByRole('status')).toHaveText(`${catalogCount} products`);
  await expect(english.getByRole('searchbox')).toHaveAttribute('placeholder', 'Reference, name or technical specification…');
  const card = await findProduct(english, 'EZ9F57116');
  await expect(card.getByRole('heading')).toContainText('Miniature circuit breaker');
  await expect(card.getByRole('link', { name: 'Official manufacturer source', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Add to distribution board: EZ9F57116', exact: true }).click();
  await english.getByRole('button', { name: 'Close product library', exact: true }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue(/Miniature circuit breaker/);
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.getByLabel('Nyelv / Language', { exact: true })).toHaveValue('en');
  await expect.poll(async () => (await readDocument(page)).data.devices.some(device => device.product?.reference === 'EZ9F57116' && device.name.includes('Miniature circuit breaker'))).toBe(true);
});

test('reopens production and searches and adds products completely offline without external requests', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page, 'http://localhost:4173/');
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await reopenRecentProject(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  const externalRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://localhost:4173/') && !request.url().startsWith('data:')) externalRequests.push(request.url()); });
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  await expect(dialog.getByRole('status')).toHaveText(`${catalogCount} termék`);
  const card = await findProduct(dialog, 'EZ9F57116');
  await card.getByRole('button', { name: 'Hozzáadás az elosztóhoz: EZ9F57116', exact: true }).click();
  await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.some(device => device.product?.reference === 'EZ9F57116')).toBe(true);
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  const product = (await readDocument(page)).data.devices.find(device => device.product?.reference === 'EZ9F57116')!;
  expect(product.moduleWidth).toBe(1);
  expect(product.product?.sourceDocument).toContain('Easy9Pro_catalog_HU');
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('phone catalogue', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('searches and adds with touch at 390px without horizontal overflow', async ({ page }) => {
    await openPlanner(page);
    await page.getByRole('button', { name: 'Eszköztár megnyitása', exact: true }).tap();
    await page.locator('.manufacturer-library-button').tap();
    const dialog = library(page);
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await expect.poll(() => dialog.locator('.product-library-results').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    const card = await findProduct(dialog, 'EZ9A29924');
    await card.getByRole('button', { name: 'Hozzáadás az elosztóhoz: EZ9A29924', exact: true }).tap();
    await page.screenshot({ path: path.join(outputDir, 'manufacturer-mobile.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása', exact: true }).tap();
    await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.product?.reference === 'EZ9A29924')?.moduleWidth).toBe(.5);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test('shows illustrative Schneider photos in the catalogue and the exported board drawing', async ({ page }) => {
  await openPlanner(page);
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  const card = await findProduct(dialog, 'EZ9F57116');
  await expect(card.locator('.product-image')).toHaveAttribute('src', /^data:image\/(?:webp|png|jpeg);base64,/);
  await expect(card.getByText('Termékcsalád illusztrációja')).toBeVisible();
  await card.getByRole('button', { name: 'Hozzáadás az elosztóhoz: EZ9F57116', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.product?.reference === 'EZ9F57116')).toBeTruthy();
  const device = (await readDocument(page)).data.devices.find(item => item.product?.reference === 'EZ9F57116')!;
  await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása' }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  if (await page.locator(`[data-device-id="${device.id}"] image`).count() === 0) {
    await page.getByRole('button', { name: 'Új DIN-sor' }).click();
    await page.getByRole('combobox', { name: '2. sor: készülék elhelyezése' }).selectOption(device.id);
  }
  await expect(page.locator(`[data-device-id="${device.id}"] image`)).toHaveAttribute('href', /^data:image\/(?:webp|png|jpeg);base64,/);
  await expect(page.locator('.wiring-diagram').getByText('I: termékcsalád illusztrációja')).toBeVisible();
});

test('places a photographed Tracon terminal with its actual width and common screws', async ({ page }) => {
  await openPlanner(page);
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  const card = await findProduct(dialog, 'FLECU-25-16-2ZS');
  await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await expect(card.locator('.product-specs')).toContainText('21,3 mm');
  await card.getByRole('button', { name: 'Hozzáadás az elosztóhoz: FLECU-25-16-2ZS' }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.product?.reference === 'FLECU-25-16-2ZS')).toBeTruthy();
  const saved = (await readDocument(page)).data.devices.find(item => item.product?.reference === 'FLECU-25-16-2ZS')!;
  expect(saved.moduleWidth).toBeCloseTo(21.3 / 18);
  expect(saved.electrical?.commonPoleGroups).toEqual([[0, 1]]);
  await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása' }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Új DIN-sor' }).click();
  await page.getByRole('combobox', { name: '2. sor: készülék elhelyezése' }).selectOption(saved.id);
  await expect(page.locator(`[data-device-id="${saved.id}"] image`)).toHaveAttribute('href', /^data:image\/webp;base64,/);
});

test('adds and places all three FLEAL-16/1 conductor variants with photos', async ({ page }) => {
  await openPlanner(page);
  await page.locator('.manufacturer-library-button').click();
  const dialog = library(page);
  const references = ['FLEAL-16/1', 'FLEAL-16/1K', 'FLEAL-16/1ZS'];
  for (const reference of references) {
    await dialog.getByRole('searchbox').fill(reference);
    const card = dialog.locator('.product-card').filter({ has: page.getByText(reference, { exact: true }) });
    await expect(card).toHaveCount(1);
    await expect(card.locator('img')).toHaveAttribute('src', /^data:image\/webp;base64,/);
    await expect(card.locator('.product-specs')).toContainText('13,9 mm');
    await card.getByRole('button', { name: `Hozzáadás az elosztóhoz: ${reference}`, exact: true }).click();
  }
  await expect.poll(async () => (await readDocument(page)).data.devices.filter(item => references.includes(item.product?.reference ?? '')).length).toBe(3);
  const devices = (await readDocument(page)).data.devices.filter(item => references.includes(item.product?.reference ?? ''));
  expect(devices.map(item => item.electrical?.poles[0])).toEqual(['L', 'N', 'PE']);
  await dialog.getByRole('button', { name: 'Termékkönyvtár bezárása' }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Új DIN-sor' }).click();
  for (const device of devices) {
    if (await page.locator(`[data-device-id="${device.id}"] image`).count() === 0)
      await page.getByRole('combobox', { name: '2. sor: készülék elhelyezése' }).selectOption(device.id);
    await expect(page.locator(`[data-device-id="${device.id}"] image`)).toHaveAttribute('href', /^data:image\/webp;base64,/);
  }
});
