import { expect, test, type Page } from '@playwright/test';
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

async function openProductPicker(page: Page) {
  await page.getByRole('button', { name: 'Gyártói termék kiválasztása', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('assigns a matching manufacturer product without changing an existing device, circuit or route', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const sample = await readDocument(page);
  const original = sample.data.devices.find(device => device.kind === 'switch' && !device.variant)!;
  expect(sample.data.sheets[0].routes.some(route => route.fromDeviceId === original.id || route.toDeviceId === original.id)).toBe(true);
  await page.getByRole('button', { name: `${original.code}, ${original.name}`, exact: true }).locator('circle').first().click();
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Saját kapcsoló');
  await page.getByLabel('Eszköz megjegyzése', { exact: true }).fill('Meglévő szerelvény megjegyzése');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.id === original.id)?.notes).toBe('Meglévő szerelvény megjegyzése');
  const before = await readDocument(page);
  const beforeDevice = before.data.devices.find(device => device.id === original.id)!;
  expect(beforeDevice.circuitId).toBeTruthy();

  const dialog = await openProductPicker(page);
  const search = dialog.getByRole('searchbox');
  await search.fill('EPH0400171'); // 106 is not a 101 switch.
  await expect(dialog.getByRole('button', { name: 'Hozzárendelés az eszközhöz: EPH0400171', exact: true })).toHaveCount(0);
  await search.fill('EPH0100171');
  const card = dialog.locator('.product-card').filter({ has: page.locator('.product-reference', { hasText: 'EPH0100171' }) });
  await expect(card).toHaveCount(1);
  await expect(card.locator('img')).toBeVisible();
  await card.getByRole('button', { name: 'Hozzárendelés az eszközhöz: EPH0100171', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.id === original.id)?.product?.reference).toBe('EPH0100171');
  const after = await readDocument(page);
  const updated = after.data.devices.find(device => device.id === original.id)!;
  expect(updated.model).toContain('EPH0100171');
  expect(updated.product).toMatchObject({ reference: 'EPH0100171', manufacturer: 'Schneider Electric', range: 'Asfora', mounting: 'floor' });
  const { model: _modelBefore, product: _productBefore, ...beforeRest } = beforeDevice;
  const { model: _modelAfter, product: _productAfter, ...afterRest } = updated;
  expect(afterRest).toEqual(beforeRest);
  expect(after.data.sheets).toEqual(before.data.sheets);
  expect(after.data.circuits).toEqual(before.data.circuits);
  expect(after.data.boards).toEqual(before.data.boards);
  expect(after.data.devices.filter(device => device.id !== original.id)).toEqual(before.data.devices.filter(device => device.id !== original.id));

  await page.reload();
  await reopenRecentProject(page);
  const restored = await readDocument(page);
  expect(restored.data.devices.find(device => device.id === original.id)).toEqual(updated);
  expect(restored.data.sheets).toEqual(before.data.sheets);
});

test('assigns and changes the product on a separately placed standard two-way switch', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const initial = await readDocument(page);
  await page.locator('.sidebar-catalog').getByRole('button', { name: 'Váltókapcsoló', exact: true }).click();
  const point = await page.locator('.floor-svg').evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('Floor plan is not rendered');
    const position = new DOMPoint(350, 350).matrixTransform(matrix);
    return { x: position.x, y: position.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await readDocument(page)).data.devices.length).toBe(initial.data.devices.length + 1);
  const placed = await readDocument(page);
  const device = placed.data.devices.find(item => item.variant === 'switch-two-way')!;
  expect(device).toBeTruthy();
  const placement = placed.data.sheets[0].placements.find(item => item.deviceId === device.id)!;

  let dialog = await openProductPicker(page);
  await dialog.getByRole('searchbox').fill('EPH0400171');
  await dialog.getByRole('button', { name: 'Hozzárendelés az eszközhöz: EPH0400171', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.id === device.id)?.product?.reference).toBe('EPH0400171');
  dialog = await openProductPicker(page);
  await dialog.getByRole('searchbox').fill('EPH0400121');
  await dialog.getByRole('button', { name: 'Hozzárendelés az eszközhöz: EPH0400121', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.id === device.id)?.product?.reference).toBe('EPH0400121');
  const updated = await readDocument(page);
  expect(updated.data.devices.filter(item => item.id === device.id)).toHaveLength(1);
  expect(updated.data.devices.find(item => item.id === device.id)).toMatchObject({ kind: 'switch', variant: 'switch-two-way' });
  expect(updated.data.sheets[0].placements.find(item => item.deviceId === device.id)).toEqual(placement);
  await page.getByLabel('Eszköz típusa', { exact: true }).fill('Másik gyártó');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.id === device.id)?.model).toBe('Másik gyártó');
  expect((await readDocument(page)).data.devices.find(item => item.id === device.id)?.product).toBeUndefined();
});

test.describe('phone product assignment', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('opens the selected device product picker and assigns a matching product', async ({ page }) => {
    await page.goto('/');
    await chooseSample(page);
    const before = await readDocument(page);
    const device = before.data.devices.find(item => item.kind === 'switch' && !item.variant)!;
    await page.getByRole('button', { name: `${device.code}, ${device.name}`, exact: true }).locator('circle').first().tap();
    const openPicker = page.getByRole('button', { name: 'Gyártói termék kiválasztása', exact: true });
    await openPicker.scrollIntoViewIfNeeded();
    await openPicker.tap();
    const dialog = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('searchbox').fill('EPH0100171');
    const select = dialog.getByRole('button', { name: 'Hozzárendelés az eszközhöz: EPH0100171', exact: true });
    await select.scrollIntoViewIfNeeded();
    await select.tap();
    await expect.poll(async () => (await readDocument(page)).data.devices.find(item => item.id === device.id)?.product?.reference).toBe('EPH0100171');
    expect((await readDocument(page)).data.sheets).toEqual(before.data.sheets);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
