import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

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
        get.onsuccess = () => { db.close(); if (!get.result?.document) reject(new Error('Missing project')); else resolve(get.result.document); };
      };
    });
  });
}

async function searchProduct(page: Page, reference: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
  await page.locator('.manufacturer-library-button').click();
  await dialog.getByRole('searchbox').fill(reference);
  const card = dialog.locator('.product-card').filter({ has: page.locator('.product-reference', { hasText: reference }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.product-reference')).toHaveText(reference);
  return card;
}

async function placeOnFloor(page: Page) {
  const point = await page.locator('.floor-svg').evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('Floor plan is not rendered');
    const position = new DOMPoint(350, 350).matrixTransform(matrix);
    return { x: position.x, y: position.y };
  });
  await page.mouse.click(point.x, point.y);
}

test('finds Asfora products and preserves a floor-placed two-way switch after reload', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const initial = await readDocument(page);
  const frame = await searchProduct(page, 'EPH5800171');
  await expect(frame.getByText('Önállóan nem helyezhető el az alaprajzon.')).toBeVisible();
  await expect(frame.getByRole('button', { name: /Elhelyezés az alaprajzon/ })).toHaveCount(0);
  const dialog = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
  await dialog.getByRole('searchbox').fill('EPH0400171');
  const card = dialog.locator('.product-card').filter({ has: page.locator('.product-reference', { hasText: 'EPH0400171' }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toBeVisible();
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await card.getByRole('button', { name: 'Elhelyezés az alaprajzon: EPH0400171', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true })).toHaveClass(/active/);
  await placeOnFloor(page);
  await expect.poll(async () => (await readDocument(page)).data.devices.length).toBe(initial.data.devices.length + 1);
  const placed = await readDocument(page);
  const device = placed.data.devices.find(item => item.product?.reference === 'EPH0400171');
  expect(device).toMatchObject({ kind: 'switch', variant: 'switch-two-way', product: { manufacturer: 'Schneider Electric', range: 'Asfora', mounting: 'floor' } });
  expect(placed.data.sheets.some(sheet => sheet.placements.some(position => position.deviceId === device!.id))).toBe(true);
  await page.reload();
  await reopenRecentProject(page);
  const restored = await readDocument(page);
  expect(restored.data.devices.find(item => item.id === device!.id)).toEqual(device);
  expect(restored.data.sheets.some(sheet => sheet.placements.some(position => position.deviceId === device!.id))).toBe(true);
});

test('cancels a pending manufacturer placement when switching tools, views or pressing Escape', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const initial = await readDocument(page);
  for (const cancel of ['escape', 'view', 'tool'] as const) {
    const card = await searchProduct(page, 'EPH0400171');
    await card.getByRole('button', { name: 'Elhelyezés az alaprajzon: EPH0400171', exact: true }).click();
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'view') {
      await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
      await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
    }
    if (cancel === 'tool') await page.getByRole('button', { name: 'Kijelölés és mozgatás', exact: true }).click();
    await placeOnFloor(page);
    expect((await readDocument(page)).data.devices).toEqual(initial.data.devices);
  }
  await page.locator('.catalog-grid').getByRole('button', { name: 'Kapcsoló', exact: true }).click();
  await placeOnFloor(page);
  await expect.poll(async () => (await readDocument(page)).data.devices.length).toBe(initial.data.devices.length + 1);
  expect((await readDocument(page)).data.devices.at(-1)?.product).toBeUndefined();
});

test('opens the Asfora catalogue and places a photographed product completely offline', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('http://localhost:4173/');
  await chooseSample(page);
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
  page.on('request', request => {
    if (!request.url().startsWith('http://localhost:4173/') && !request.url().startsWith('data:')) externalRequests.push(request.url());
  });
  const card = await searchProduct(page, 'EPH0400171');
  await expect(card.locator('img')).toBeVisible();
  await expect.poll(() => card.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await card.getByRole('button', { name: 'Elhelyezés az alaprajzon: EPH0400171', exact: true }).click();
  await placeOnFloor(page);
  await expect.poll(async () => (await readDocument(page)).data.devices.some(item => item.product?.reference === 'EPH0400171' && item.variant === 'switch-two-way')).toBe(true);
  expect(externalRequests).toEqual([]);
});
