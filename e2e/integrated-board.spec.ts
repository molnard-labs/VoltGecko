import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSample, reopenRecentProject } from './startup';

type SavedProject = {
  data: {
    circuits: Array<{ id: string; code: string; name: string }>;
    devices: Array<{ id: string; code: string; circuitId?: string }>;
    sheets: Array<{ placements: Array<{ deviceId: string }> }>;
    boardPlanner?: { comps: Array<{ id: string; vgCircuitId?: string }> };
  };
};

async function savedProject(page: Page): Promise<SavedProject> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    if (!id) throw new Error('No active project');
    return new Promise<SavedProject>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { db.close(); if (!get.result?.document) reject(new Error('Missing document')); else resolve(get.result.document); };
      };
    });
  });
}

test('links a floor-plan device and new board breaker to one circuit, then preserves them in the project archive', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  await expect(page.locator('.floor-device')).toHaveCount(8);

  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  await page.getByRole('button', { name: 'Új áramkör', exact: true }).click();
  await page.getByLabel('ÁK4 neve', { exact: true }).fill('Konyhai közös áramkör');
  await expect.poll(async () => (await savedProject(page)).data.circuits.find(c => c.code === 'ÁK4')?.name).toBe('Konyhai közös áramkör');
  const circuitId = (await savedProject(page)).data.circuits.find(c => c.code === 'ÁK4')!.id;

  await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
  await page.locator('.catalog-grid').getByRole('button', { name: 'Dugalj', exact: true }).click();
  const point = await page.locator('.floor-svg').evaluate((element) => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('Floor plan is not rendered');
    const p = new DOMPoint(350, 350).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('D4');
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Konyhai tesztdugalj');
  await page.getByLabel('Eszköz áramköre', { exact: true }).selectOption(circuitId);
  await expect.poll(async () => (await savedProject(page)).data.devices.find(d => d.code === 'D4')?.circuitId).toBe(circuitId);
  const outletId = (await savedProject(page)).data.devices.find(d => d.code === 'D4')!.id;
  expect((await savedProject(page)).data.sheets.some(sheet => sheet.placements.some(p => p.deviceId === outletId))).toBe(true);

  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz', exact: true }).click();
  const planner = page.frameLocator('iframe[title="Elosztótervező"]');
  await planner.getByRole('button', { name: 'Kismegszakító 1P hozzáadása', exact: true }).click();
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(1);
  await planner.locator('#cabsvg [data-comp] rect').first().click({ position: { x: 4, y: 22 } });
  await planner.getByLabel('Közös projektáramkör', { exact: true }).selectOption(circuitId);
  await expect(planner.getByLabel('Közös projektáramkör', { exact: true })).toHaveValue(circuitId);
  await expect.poll(async () => (await savedProject(page)).data.boardPlanner?.comps.some(component => component.vgCircuitId === circuitId)).toBe(true);
  await planner.getByLabel('Áramkör / fogyasztó neve', { exact: true }).fill('Elosztóból módosítva');
  await expect.poll(async () => (await savedProject(page)).data.circuits.find(c => c.id === circuitId)?.name).toBe('Elosztóból módosítva');
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  await expect(page.getByLabel('ÁK4 neve', { exact: true })).toHaveValue('Elosztóból módosítva');
  await page.getByLabel('ÁK4 neve', { exact: true }).fill('Konyhai közös áramkör');
  await expect.poll(async () => (await savedProject(page)).data.circuits.find(c => c.id === circuitId)?.name).toBe('Konyhai közös áramkör');
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz', exact: true }).click();
  await planner.locator('#cabsvg [data-comp] rect').first().click({ position: { x: 4, y: 22 } });
  await expect(planner.getByLabel('Áramkör / fogyasztó neve', { exact: true })).toHaveValue('Konyhai közös áramkör');
  await page.locator('.view-tabs').getByRole('button', { name: 'Egyvonalas', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz egyvonalasának megnyitása', exact: true }).click();
  await expect(planner.getByRole('tab', { name: 'Egyvonalas rajz', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(planner.locator('#sldwrap svg')).toContainText('Konyhai közös áramkör');
  const board = (await savedProject(page)).data.boardPlanner;

  await page.reload();
  await reopenRecentProject(page);
  expect((await savedProject(page)).data.devices.find(d => d.id === outletId)?.circuitId).toBe(circuitId);
  expect((await savedProject(page)).data.boardPlanner).toEqual(board);

  for (const [label, filename] of [['PDF a megrendelőnek', 'client.pdf'], ['Részletes szakmai PDF', 'professional.pdf']] as const) {
    await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
    const pdfEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: false }).click();
    const pdfFile = await pdfEvent;
    const pdfPath = testInfo.outputPath(filename);
    await pdfFile.saveAs(pdfPath);
    const loadingPdf = getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: true });
    const pdf = await loadingPdf.promise;
    const pages: Array<{ text: string; hasImage: boolean }> = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const pdfPage = await pdf.getPage(number);
      const content = await pdfPage.getTextContent();
      const operators = await pdfPage.getOperatorList();
      pages.push({ text: content.items.map(item => 'str' in item ? item.str : '').join(' '),
        hasImage: operators.fnArray.some(op => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject) });
    }
    expect(pages.some(item => item.text.includes('Elosztó · szekrényrajz') && item.hasImage)).toBe(true);
    expect(pages.some(item => item.text.includes('Elosztó · egyvonalas rajz') && item.hasImage)).toBe(true);
    expect(pages.some(item => item.text.includes('Dunaparti lakás'))).toBe(true);
    expect(pages.some(item => item.text.includes(label.startsWith('PDF a megrendelőnek') ? 'Mi hova kerül?' : 'Áramkörjegyzék'))).toBe(true);
    await loadingPdf.destroy();
  }

  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Projektfájl mentése/ }).click();
  const archive = await downloadPromise;
  const archivePath = testInfo.outputPath('integrated-board.vgecko');
  await archive.saveAs(archivePath);
  // A changed local copy causes archive import to create a separate project.
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  await page.getByLabel('ÁK4 neve', { exact: true }).fill('Újabb helyi változat');
  await expect.poll(async () => (await savedProject(page)).data.circuits.find(c => c.id === circuitId)?.name).toBe('Újabb helyi változat');
  await page.locator('input[accept*=".vgecko"]').setInputFiles(archivePath);
  await expect(page.locator('.project-title')).toContainText('importált másolat');
  await expect.poll(async () => (await savedProject(page)).data.boardPlanner).toEqual(board);
  const imported = (await savedProject(page)).data;
  expect(imported.circuits.find(c => c.id === circuitId)?.name).toBe('Konyhai közös áramkör');
  expect(imported.devices.find(d => d.id === outletId)?.circuitId).toBe(circuitId);
  expect(imported.sheets.some(sheet => sheet.placements.some(p => p.deviceId === outletId))).toBe(true);
  expect(errors).toEqual([]);
});

test('imports an earlier standalone board only when requested and keeps its source intact', async ({ page }) => {
  const raw = await readFile(path.join(process.cwd(), 'e2e/fixtures/kistarcsa-eloszto.json'), 'utf8');
  await page.addInitScript(value => localStorage.setItem('eloszto-tervezo-v2', value), raw);
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz', exact: true }).click();
  const planner = page.frameLocator('iframe[title="Elosztótervező"]');
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(0);
  await planner.getByRole('button', { name: 'Elosztóterv', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await planner.getByRole('button', { name: 'Korábbi önálló elosztóterv átvétele', exact: true }).click();
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(39);
  await expect.poll(async () => (await savedProject(page)).data.boardPlanner?.comps.length).toBe(39);
  expect(await page.evaluate(() => localStorage.getItem('eloszto-tervezo-v2'))).toBe(raw);
  const before = (await savedProject(page)).data.boardPlanner;
  const broken = JSON.parse(raw);
  broken.wires[0].a.c = 'missing-device';
  await page.evaluate(value => localStorage.setItem('eloszto-tervezo-v2', value), JSON.stringify(broken));
  await planner.getByRole('button', { name: 'Elosztóterv', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await planner.getByRole('button', { name: 'Korábbi önálló elosztóterv átvétele', exact: true }).click();
  await expect(planner.locator('#toast')).toContainText('nem olvasható');
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(39);
  expect((await savedProject(page)).data.boardPlanner).toEqual(before);
  const brokenPole = JSON.parse(raw);
  brokenPole.wires[0].a.p = 99;
  await page.evaluate(value => localStorage.setItem('eloszto-tervezo-v2', value), JSON.stringify(brokenPole));
  page.once('dialog', dialog => dialog.accept());
  await planner.getByRole('button', { name: 'Korábbi önálló elosztóterv átvétele', exact: true }).click();
  await expect(planner.locator('#toast')).toContainText('nem olvasható');
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(39);
  expect((await savedProject(page)).data.boardPlanner).toEqual(before);
});

test('opens the integrated board for the first time without a network after PWA installation', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('http://localhost:4173/');
  await chooseSample(page);
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await reopenRecentProject(page);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz', exact: true }).click();
  const planner = page.frameLocator('iframe[title="Elosztótervező"]');
  await planner.getByRole('button', { name: 'Kismegszakító 1P hozzáadása', exact: true }).click();
  await expect(planner.locator('#cabsvg [data-comp]')).toHaveCount(1);
  await expect.poll(async () => (await savedProject(page)).data.boardPlanner?.comps.length).toBe(1);
});

