import { chooseSample, reopenRecentProject } from './startup';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectDocument } from '../src/types';

const qaDir = path.resolve('tmp/qa');

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

async function openPlanner(page: Page) {
  // Exercise the universal download fallback rather than a browser's native
  // file-picker UI, which cannot be automated through the web platform.
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  await expect(page.getByRole('button', { name: 'Dunaparti lakás', exact: true })).toBeVisible();
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
}

async function worldPosition(page: Page, x: number, y: number) {
  return page.locator('.floor-svg').evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('SVG is not rendered');
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

async function devicePosition(device: Locator) {
  return device.evaluate(element => {
    const matrix = (element as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error('Device is not rendered');
    const screen = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  });
}

function floorDevice(page: Page, code: string) { return page.locator('.floor-device').filter({ has: page.locator(`text`, { hasText: new RegExp(`^${code}$`) }) }); }
async function clickDevice(page: Page, code: string) { const p = await devicePosition(floorDevice(page, code)); await page.mouse.click(p.x, p.y); }

test.beforeAll(async () => { await mkdir(qaDir, { recursive: true }); });

test('explicitly opens a sample project and keeps it across reloads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page);
  const initial = await readDocument(page);
  expect(initial.data.devices).toHaveLength(14);
  await expect(page.locator('.floor-device')).toHaveCount(8);
  await expect(page.locator('.floor-svg image')).toHaveAttribute('href', /^data:image\/svg\+xml;base64,/);
  await page.locator('.project-switch').click();
  await expect(page.locator('.project-list > article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ablak bezárása', exact: true }).click();
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.locator('.floor-device')).toHaveCount(8);
  expect((await readDocument(page)).data.id).toBe(initial.data.id);
  await page.screenshot({ path: path.join(qaDir, 'desktop-floor.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('adds and edits a floor device, preserves its circuit and undoes one drag', async ({ page }) => {
  await openPlanner(page);
  const initial = await readDocument(page);
  await page.locator('.catalog-grid').getByRole('button', { name: 'Dugalj', exact: true }).click();
  const point = await worldPosition(page, 350, 350);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('D4');
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Pult alatti dugalj');
  await page.getByLabel('Helyiség', { exact: true }).fill('Konyha');
  await page.getByLabel('Szerelési magasság', { exact: true }).fill('1150');
  await page.getByLabel('Eszköz áramköre', { exact: true }).selectOption(initial.data.circuits[0].id);
  await expect.poll(async () => (await readDocument(page)).data.devices.find(d => d.code === 'D4')?.heightMm).toBe(1150);
  const added = (await readDocument(page)).data.devices.find(d => d.code === 'D4')!;
  expect(added.name).toBe('Pult alatti dugalj');
  expect(added.circuitId).toBe(initial.data.circuits[0].id);
  await expect(floorDevice(page, 'D4').locator('g > g').first()).toHaveCount(1);
  const before = (await readDocument(page)).data.sheets[0].placements.find(p => p.deviceId === added.id)!;
  const position = await devicePosition(floorDevice(page, 'D4'));
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x + 55, position.y + 28, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].placements.find(p => p.deviceId === added.id)?.x).toBeGreaterThan(before.x + 10);
  await page.getByRole('button', { name: 'Visszavonás', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].placements.find(p => p.deviceId === added.id)?.x).toBeCloseTo(before.x, 3);
  expect((await readDocument(page)).data.sheets[0].placements.find(p => p.deviceId === added.id)?.y).toBeCloseTo(before.y, 3);
  await clickDevice(page, 'D4');
  await expect(page.getByLabel('Eszköz neve', { exact: true })).toHaveValue('Pult alatti dugalj');
  await page.reload();
  await reopenRecentProject(page);
  await clickDevice(page, 'D4');
  await expect(page.getByLabel('Helyiség', { exact: true })).toHaveValue('Konyha');
});

test('connects two devices and edits the route bend', async ({ page }) => {
  await openPlanner(page);
  const count = (await readDocument(page)).data.sheets[0].routes.length;
  await page.getByRole('button', { name: 'Kapcsolat / nyomvonal', exact: true }).click();
  await clickDevice(page, 'D1');
  await expect(page.locator('.floor-instruction')).toContainText('másik eszközét');
  await clickDevice(page, 'D2');
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].routes.length).toBe(count + 1);
  const route = (await readDocument(page)).data.sheets[0].routes.at(-1)!;
  expect(route.kind).toBe('power');
  expect(route.circuitId).toBe((await readDocument(page)).data.circuits[0].id);
  await expect(page.locator('.floor-bend')).toHaveCount(2);
  const bend = await page.locator('.floor-bend').first().boundingBox();
  if (!bend) throw new Error('Missing route bend');
  await page.mouse.move(bend.x + bend.width / 2, bend.y + bend.height / 2);
  await page.mouse.down();
  await page.mouse.move(bend.x + bend.width / 2 + 25, bend.y + bend.height / 2 + 15, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].routes.at(-1)!.points[1].x).toBeGreaterThan(route.points[1].x);
});

test('centers a sidebar-selected device outside the view while preserving zoom', async ({ page }) => {
  await openPlanner(page);
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Nagyítás', exact: true }).click();
  const before = await page.locator('.floor-svg').getAttribute('viewBox');
  const initial = before!.split(' ').map(Number);
  const hiddenPosition = await devicePosition(floorDevice(page, 'D1'));
  const bounds = (await page.locator('.floor-svg').boundingBox())!;
  expect(hiddenPosition.x < bounds.x || hiddenPosition.x > bounds.x + bounds.width || hiddenPosition.y < bounds.y || hiddenPosition.y > bounds.y + bounds.height).toBe(true);
  await page.locator('.device-list').getByRole('button', { name: 'D1 Dugalj Nappali', exact: true }).click();
  await expect.poll(async () => page.locator('.floor-svg').getAttribute('viewBox')).not.toBe(before);
  const centered = (await page.locator('.floor-svg').getAttribute('viewBox'))!.split(' ').map(Number);
  expect(centered[2]).toBeCloseTo(initial[2], 5);
  expect(centered[3]).toBeCloseTo(initial[3], 5);
  const position = await devicePosition(floorDevice(page, 'D1'));
  expect(position.x).toBeGreaterThan(bounds.x + 24);
  expect(position.x).toBeLessThan(bounds.x + bounds.width - 24);
  await page.getByRole('button', { name: 'Kijelölés bezárása', exact: true }).click();
  await page.mouse.click(position.x, position.y);
  expect((await page.locator('.floor-svg').getAttribute('viewBox'))!.split(' ').map(Number)).toEqual(centered);
});

test('adds a board device and reports width overflow and overlapping module slots', async ({ page }) => {
  await openPlanner(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await expect(page.locator('rect.wiring-device')).toHaveCount(6);
  await page.locator('.catalog-grid').getByRole('button', { name: /Kismegszakító/ }).click();
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('QF4');
  await expect(page.locator('rect.wiring-device')).toHaveCount(7);
  await page.getByLabel('Modulszélesség', { exact: true }).fill('3');
  await expect(page.locator('.validation-box')).toContainText('túllóg');
  await page.getByLabel('Kezdő modulhely', { exact: true }).fill('1');
  await expect(page.locator('.validation-box')).toContainText('ütköző modulfoglalás');
  await expect(page.locator('rect.wiring-device.invalid')).not.toHaveCount(0);
  await page.screenshot({ path: path.join(qaDir, 'desktop-board-validation.png'), fullPage: true });
});

test('saves a checkpoint, undoes and redoes an edit, then restores without losing history', async ({ page }) => {
  await openPlanner(page);
  await clickDevice(page, 'D1');
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Elmentett dugalj');
  await page.locator('.save-version-button').click();
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Ideiglenes módosítás');
  await page.getByRole('button', { name: 'Visszavonás', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(d => d.code === 'D1')?.name).toBe('Elmentett dugalj');
  await page.getByRole('button', { name: 'Újra', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(d => d.code === 'D1')?.name).toBe('Ideiglenes módosítás');
  await page.locator('.view-tabs').getByRole('button', { name: /Előzmények/ }).click();
  const revision = page.locator('.timeline article').filter({ has: page.getByRole('heading', { name: 'Mentett változat', exact: true }) });
  await expect(revision).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await revision.getByRole('button', { name: 'Visszaállítás', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.devices.find(d => d.code === 'D1')?.name).toBe('Elmentett dugalj');
  const restored = await readDocument(page);
  expect(restored.revisions).toHaveLength(4);
  expect(restored.revisions.at(-1)?.restoredFrom).toBeTruthy();
  expect(restored.revisions.some(r => r.note === 'Visszaállítás előtti állapot')).toBe(true);
});

test('exports a complete archive and imports an older state as a preserved separate copy', async ({ page }) => {
  await openPlanner(page);
  await clickDevice(page, 'D1');
  await page.getByLabel('Eszköz megjegyzése', { exact: true }).fill('Átadási próba – őrizd meg!');
  await page.locator('.photo-upload input').setInputFiles({ name: 'helyszin.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQykAAAAASUVORK5CYII=', 'base64') });
  await expect(page.locator('.photo-grid img')).toHaveCount(1);
  await page.getByRole('button', { name: /Mentés és export/ }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Projektfájl mentése/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.vgecko$/);
  const archivePath = path.join(qaDir, 'roundtrip.vgecko');
  await download.saveAs(archivePath);
  const exported = await readDocument(page);
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Újabb helyi változat');
  await expect.poll(async () => (await readDocument(page)).data.devices[0].name).toBe('Újabb helyi változat');
  await page.locator('input[accept*=".vgecko"]').setInputFiles(archivePath);
  await expect(page.locator('.project-switch strong')).toContainText('importált másolat');
  const imported = await readDocument(page);
  expect(imported.data.id).not.toBe(exported.data.id);
  expect(imported.data.devices).toEqual(exported.data.devices);
  expect(imported.assets).toEqual(exported.assets);
  expect(imported.revisions.map(r => r.id)).toEqual(exported.revisions.map(r => r.id));
  await page.locator('.project-switch').click();
  await expect(page.locator('.project-list > article')).toHaveCount(2);
});

test('checkpoints the current undo result when undo and quick save occur in the same event turn', async ({ page }) => {
  await openPlanner(page);
  const initial = await readDocument(page);
  const original = initial.data.devices.find(device => device.code === 'D1')!;
  await clickDevice(page, 'D1');
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Temporary device name');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.id === original.id)?.name).toBe('Temporary device name');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('button[aria-label="Visszavonás"]')!.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  });
  await expect.poll(async () => (await readDocument(page)).revisions.at(-1)?.note).toBe('Gyors mentés');
  const saved = await readDocument(page);
  expect(saved.data.devices.find(device => device.id === original.id)?.name).toBe(original.name);
  expect(saved.revisions.at(-1)?.data.devices.find(device => device.id === original.id)?.name).toBe(original.name);
});

test.describe('phone field editing', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('draws a connection with touch while keeping the inspector out of the way',async({page})=>{
    await openPlanner(page);
    await page.getByRole('button',{name:'Vezérlési kapcsolat',exact:true}).tap();
    const first=await devicePosition(floorDevice(page,'D1'));
    await page.touchscreen.tap(first.x,first.y);
    await expect(page.locator('.inspector.has-selection')).toHaveCount(0);
    const second=await devicePosition(floorDevice(page,'D2'));
    await page.touchscreen.tap(second.x,second.y);
    await expect.poll(async()=>(await readDocument(page)).data.sheets[0].routes.filter(r=>r.kind==='control').length).toBe(2);
    await expect(page.locator('.inspector.has-selection')).toHaveCount(0);
  });
  test('fits a phone and adds an outlet with touch without horizontal overflow', async ({ page }) => {
    await openPlanner(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(qaDir, 'mobile-floor.png'), fullPage: true });
    await page.getByRole('button', { name: 'Eszköztár megnyitása', exact: true }).tap();
    await page.locator('.catalog-grid').getByRole('button', { name: 'Dugalj', exact: true }).tap();
    await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
    const point = await worldPosition(page, 600, 350);
    await page.touchscreen.tap(point.x, point.y);
    await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('D4');
    await page.getByLabel('Eszköz megjegyzése', { exact: true }).fill('Helyszíni telefonos módosítás');
    await expect.poll(async () => (await readDocument(page)).data.devices.find(d => d.code === 'D4')?.notes).toBe('Helyszíni telefonos módosítás');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(qaDir, 'mobile-device-edit.png'), fullPage: true });
  });
});
