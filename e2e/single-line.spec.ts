import { chooseSample, reopenRecentProject } from './startup';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectDocument } from '../src/types';

const outputDir = path.resolve('tmp/single-line-results');
const cable = 'NYM-J 3×2,5 mm²';
const supply = 'Lakásbetáp · 3×400/230 V';

async function readDocument(page: Page, projectId?: string): Promise<ProjectDocument> {
  return page.evaluate(async requestedId => {
    const id = requestedId ?? localStorage.getItem('planner.activeProject');
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
  }, projectId);
}

async function openPlanner(page: Page, url = '/') {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto(url);
  await chooseSample(page);
  await expect(page.locator('.project-title')).toHaveText(/Dunaparti lakás/);
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
}

async function tab(page: Page, name: string) {
  await page.locator('.view-tabs').getByRole('button', { name, exact: true }).click();
}

async function configureGraph(page: Page): Promise<ProjectDocument> {
  const original = await readDocument(page);
  const main = original.data.devices.find(device => device.code === 'Q1')!;
  const rcd = original.data.devices.find(device => device.code === 'FI1')!;
  const breaker = original.data.devices.find(device => device.code === 'QF1')!;
  await tab(page, 'Elosztó');
  await page.getByRole('button', { name: 'Betáplálás hozzáadása', exact: true }).click();
  await page.locator('.wiring-item>summary').filter({ hasText: 'Külső betáplálás' }).click();
  await page.getByLabel('1. betáplálás neve', { exact: true }).fill(supply);
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.infeeds.length).toBe(1);
  const source = (await readDocument(page)).data.boards[0].wiring!.infeeds[0];
  const endpoint = (deviceId: string, side: 'top' | 'bottom') => ({ kind: 'device', deviceId, side, pole: 0 });
  const connect = async (from: object, to: object) => {
    await page.getByLabel('Vezeték kezdőpontja', { exact: true }).selectOption(JSON.stringify(from));
    await page.getByLabel('Vezeték végpontja', { exact: true }).selectOption(JSON.stringify(to));
    await page.getByRole('button', { name: 'Vezeték létrehozása', exact: true }).click();
  };
  await connect({ kind: 'infeed', infeedId: source.id, pole: 0 }, endpoint(main.id, 'top'));
  await connect(endpoint(main.id, 'bottom'), endpoint(rcd.id, 'top'));
  await connect(endpoint(rcd.id, 'bottom'), endpoint(breaker.id, 'top'));
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.wires.length).toBe(3);
  await tab(page, 'Áramkörök');
  await page.getByLabel('ÁK1 kábele', { exact: true }).fill(cable);
  await page.getByLabel('ÁK1 teljesítménye', { exact: true }).fill('1234.5');
  await page.getByLabel('ÁK1 fogyasztótípusa', { exact: true }).selectOption('socket');
  await expect.poll(async () => {
    const circuit = (await readDocument(page)).data.circuits[0];
    return { cable: circuit.cable, powerW: circuit.powerW, loadType: circuit.loadType };
  }).toEqual({ cable, powerW: 1234.5, loadType: 'socket' });
  const document = await readDocument(page);
  expect(document.data.boards[0].wiring?.wires).toHaveLength(3);
  expect(document.data.devices.map(device => [device.id, device.code])).toEqual(original.data.devices.map(device => [device.id, device.code]));
  return document;
}


async function expectPhysicalWires(page: Page, document: ProjectDocument) {
  const svg = page.locator('.single-line-svg svg');
  const wires = document.data.boards[0].wiring!.wires;
  expect(wires).toHaveLength(3);
  for (const wire of wires) await expect(svg.locator(`[data-connection-id="${wire.id}"]`)).toHaveCount(1);
}

async function exportArchive(page: Page, filename: string) {
  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Projektfájl mentése/ }).click();
  const download = await downloading;
  const destination = path.join(outputDir, filename);
  await download.saveAs(destination);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  return destination;
}

test.beforeAll(async () => { await mkdir(outputDir, { recursive: true }); });

test('edits shared board and circuit data, keeps stable device identities, translates and downloads the actual SVG', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page);
  const configured = await configureGraph(page);
  await tab(page, 'Egyvonalas');
  const svg = page.locator('.single-line-svg svg');
  await expectPhysicalWires(page, configured);
  for (const placement of configured.data.boards[0].rows.flatMap(row => row.placements)) {
    await expect(svg.locator(`[data-device-id="${placement.deviceId}"]`).first()).toHaveCount(1);
  }
  await expect(svg).toContainText(supply);
  await expect(svg).toContainText(cable);
  await expect(svg).toContainText(/1\s?234,5 W/);
  const breaker = configured.data.devices.find(device => device.code === 'QF1')!;
  await svg.locator(`[data-device-id="${breaker.id}"]`).first().click();
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('QF1');
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Konyha & pult <A>');
  await expect(svg).toContainText('Konyha & pult <A>');
  await page.getByLabel('Nyelv / Language', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Single-line diagram', exact: true })).toBeVisible();
  await expect(svg).toContainText('1,234.5 W');
  await expect(svg).toContainText(cable);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/-single-line\.svg$/);
  const filename = path.join(outputDir, 'shared-diagram-en.svg');
  await download.saveAs(filename);
  const source = await readFile(filename, 'utf8');
  expect(source).toContain('xmlns="http://www.w3.org/2000/svg"');
  for (const wire of configured.data.boards[0].wiring!.wires) expect(source).toContain(`data-connection-id="${wire.id}"`);
  expect(source).toContain('Konyha &amp; pult &lt;A&gt;');
  expect(source).toContain(cable);
  expect(source).toContain('1,234.5 W');
  expect(source).not.toMatch(/<script|<foreignObject|https?:\/\/(?!www\.w3\.org)/i);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.screenshot({ path: path.join(outputDir, 'single-line-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save and export', exact: true }).click();
  const pdfDownloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Detailed technical PDF/ }).click();
  const pdf = await pdfDownloading;
  await pdf.saveAs(path.join(outputDir, 'diagram-en.pdf'));
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  const document = await readDocument(page);
  expect(document.data.devices.map(device => [device.id, device.code])).toEqual(configured.data.devices.map(device => [device.id, device.code]));
  expect(document.data.circuits[0]).toMatchObject({ cable, powerW: 1234.5, loadType: 'socket' });
  expect(errors).toEqual([]);
});

test('restores connection and load fields in a new version and preserves an edited original when its archive is imported', async ({ page }) => {
  test.setTimeout(90_000);
  await openPlanner(page);
  const configured = await configureGraph(page);
  await page.locator('.main-nav').getByRole('button', { name: /Előzmények/ }).click();
  await page.getByLabel('Verzió megjegyzése', { exact: true }).fill('QA: kapcsolatok és fogyasztó');
  await page.locator('.revision-compose').getByRole('button', { name: 'Verzió mentése', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).revisions.at(-1)?.note).toBe('QA: kapcsolatok és fogyasztó');
  const revisionId = (await readDocument(page)).headRevisionId;
  await tab(page, 'Áramkörök');
  await page.getByLabel('ÁK1 teljesítménye', { exact: true }).fill('99');
  await tab(page, 'Elosztó');
  await page.locator('.wiring-wire-list button').last().click();
  await page.getByRole('button', { name: 'Vezeték törlése', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.wires.length).toBe(2);
  await page.locator('.main-nav').getByRole('button', { name: /Előzmények/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('.timeline article').filter({ has: page.getByRole('heading', { name: 'QA: kapcsolatok és fogyasztó', exact: true }) }).getByRole('button', { name: 'Visszaállítás', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).revisions.at(-1)?.restoredFrom).toBe(revisionId);
  const restored = await readDocument(page);
  expect(restored.data.boards).toEqual(configured.data.boards);
  expect(restored.data.circuits[0]).toMatchObject({ cable, powerW: 1234.5, loadType: 'socket' });
  const archive = await exportArchive(page, 'single-line-roundtrip.vgecko');
  const exported = await readDocument(page);
  await tab(page, 'Áramkörök');
  await page.getByLabel('ÁK1 kábele', { exact: true }).fill('Megőrzendő helyi módosítás');
  await expect.poll(async () => (await readDocument(page)).data.circuits[0].cable).toBe('Megőrzendő helyi módosítás');
  await page.locator('input[accept*=".vgecko"]').setInputFiles(archive);
  await expect(page.locator('.project-title')).toContainText('importált másolat');
  const imported = await readDocument(page);
  expect(imported.data.id).not.toBe(exported.data.id);
  expect(imported.data.boards).toEqual(exported.data.boards);
  expect(imported.data.circuits).toEqual(exported.data.circuits);
  expect(imported.revisions.map(revision => ({ ...revision.data, id: exported.data.id }))).toEqual(exported.revisions.map(revision => revision.data));
  const original = await readDocument(page, exported.data.id);
  expect(original.data.circuits[0].cable).toBe('Megőrzendő helyi módosítás');
  await tab(page, 'Egyvonalas');
  await expectPhysicalWires(page, configured);
});

test('reopens the production diagram and edits its source data completely offline', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page, 'http://localhost:4173/');
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  const configured = await configureGraph(page);
  await tab(page, 'Egyvonalas');
  await expectPhysicalWires(page, configured);
  await page.reload();
  await reopenRecentProject(page);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const externalRequests: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://localhost:4173/') && !/^(data:|blob:)/.test(request.url())) externalRequests.push(request.url()); });
  await context.setOffline(true);
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  await tab(page, 'Egyvonalas');
  await expectPhysicalWires(page, configured);
  await expect(page.locator('.single-line-svg')).toContainText(cable);
  await tab(page, 'Áramkörök');
  await page.getByLabel('ÁK1 teljesítménye', { exact: true }).fill('2468');
  await expect.poll(async () => (await readDocument(page)).data.circuits[0].powerW).toBe(2468);
  await page.reload();
  await reopenRecentProject(page);
  await tab(page, 'Egyvonalas');
  await expect(page.locator('.single-line-svg')).toContainText(/2\s?468 W/);
  await expectPhysicalWires(page, configured);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('phone single-line planning', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('uses touch to define feeds and inspect and zoom the shared diagram without page overflow', async ({ page }) => {
    await openPlanner(page);
    const configured = await configureGraph(page);
    await tab(page, 'Egyvonalas');
    await expect(page.getByRole('heading', { name: 'Egyvonalas rajz', exact: true })).toBeVisible();
    await expectPhysicalWires(page, configured);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const before = await page.getByRole('status', { name: 'A rajz nagyítása', exact: true }).textContent();
    await page.getByRole('button', { name: 'Rajz nagyítása', exact: true }).tap();
    await expect(page.getByRole('status', { name: 'A rajz nagyítása', exact: true })).not.toHaveText(before!);
    await page.getByRole('button', { name: 'Rajz illesztése', exact: true }).tap();
    await expect.poll(() => page.locator('.single-line-stage').evaluate(element => {
      const paper = element.querySelector('.single-line-paper') as HTMLElement;
      return paper.offsetWidth - element.clientWidth;
    })).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(outputDir, 'single-line-mobile-diagram.png'), fullPage: true });
    const main = configured.data.devices.find(device => device.code === 'Q1')!;
    await page.locator(`.single-line-svg [data-device-id="${main.id}"]`).first().tap();
    await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('Q1');
    await page.screenshot({ path: path.join(outputDir, 'single-line-mobile.png'), fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});


test('renders and exports actual single-phase FI, breaker and N/PE circuit connections', async ({ page }) => {
  await openPlanner(page);
  // Reopen after writing the isolated browser fixture so no React state can overwrite it.
  await page.reload();
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('villamos-tervezo-local');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
      const get = store.get(localStorage.getItem('planner.activeProject'));
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const row = get.result, data = row.document.data, board = data.boards[0];
        const find = (code: string) => data.devices.find((d: { code: string }) => d.code === code);
        const fi = find('FI1'), first = find('QF1'), second = find('QF2');
        fi.electrical = { role: 'rccb', poles: ['L', 'N'], physicalPoleOrder: [1, 0], currentA: 40, residualCurrentMa: 30, residualType: 'A' };
        first.electrical = { role: 'mcb', poles: ['L'], currentA: 16, curve: 'B' };
        second.electrical = { role: 'mcb', poles: ['L'], currentA: 10, curve: 'B' };
        second.rating = 'B10';
        const device = (id: string, side: string, pole = 0) => ({ kind: 'device', deviceId: id, side, pole });
        const input = (pole: number) => ({ kind: 'infeed', infeedId: 'qa-supply', pole });
        const bus = (busId: string, terminal: number) => ({ kind: 'bus', busId, terminal });
        const wire = (id: string, from: object, to: object) => ({ id, from, to });
        board.connections = [];
        board.wiring = {
          infeeds: [{ id: 'qa-supply', name: 'Lakásbetáp 1×230 V', kind: 'supply', poles: ['L', 'N', 'PE'] }],
          buses: [
            { id: 'qa-n', name: 'N sín', conductor: 'N', capacity: 8, position: 'bottom', terminalLabels: [] },
            { id: 'qa-pe', name: 'PE sín', conductor: 'PE', capacity: 8, position: 'bottom', terminalLabels: [] },
          ],
          wires: [
            wire('qa-l', input(0), device(fi.id, 'top', 0)),
            wire('qa-n-in', input(1), device(fi.id, 'top', 1)),
            wire('qa-pe-in', input(2), bus('qa-pe', 0)),
            wire('qa-fi-mcb', device(fi.id, 'bottom', 0), device(first.id, 'top')),
            wire('qa-mcb-mcb', device(first.id, 'top'), device(second.id, 'top')),
            wire('qa-n-out', device(fi.id, 'bottom', 1), bus('qa-n', 0)),
          ],
        };
        for (const [index, circuit] of data.circuits.entries()) {
          if (index > 1) { circuit.boardConnections = []; continue; }
          const breaker = index === 0 ? first : second;
          circuit.cable = 'NYM-J 3×2,5 mm²';
          // Deliberately stale metadata must not override the real L terminal.
          circuit.protectionDeviceId = index === 0 ? second.id : first.id;
          circuit.boardConnections = [{ boardId: board.id, terminals: [
            { conductor: 'L', endpoint: device(breaker.id, 'bottom') },
            { conductor: 'N', endpoint: bus('qa-n', index + 1) },
            { conductor: 'PE', endpoint: bus('qa-pe', index + 1) },
          ] }];
        }
        data.circuitBoardMigration = true;
        store.put(row);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await reopenRecentProject(page);
  const configured = await readDocument(page);
  await tab(page, 'Egyvonalas');
  const svg = page.locator('.single-line-svg svg');
  await expect(svg).toContainText('Lakásbetáp 1×230 V');
  await expect(svg).toContainText('N sín');
  await expect(svg).toContainText('PE sín');
  for (const wire of configured.data.boards[0].wiring!.wires) await expect(svg.locator(`[data-connection-id="${wire.id}"]`)).toHaveCount(1);
  for (const [index, circuit] of configured.data.circuits.slice(0, 2).entries()) {
    for (const conductor of ['L', 'N', 'PE']) {
      await expect(svg.locator(`[data-circuit-id="${circuit.id}"][data-circuit-port="${conductor}"]`)).toHaveCount(1);
      const row = svg.locator(`[data-connection-id="circuit:${circuit.id}:${configured.data.boards[0].id}:${conductor}"]`);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(conductor === 'L' ? `QF${index + 1}` : `${conductor} sín`);
    }
  }
  const fi = configured.data.devices.find(device => device.code === 'FI1')!;
  const mcb = configured.data.devices.find(device => device.code === 'QF1')!;
  await expect(svg.locator(`[data-device-id="${fi.id}"][data-conductor="L"]`)).toHaveCount(1);
  await expect(svg.locator(`[data-device-id="${fi.id}"][data-conductor="N"]`)).toHaveCount(1);
  const symbol = svg.locator(`[data-device-id="${mcb.id}"][data-conductor="L"]`);
  await page.keyboard.press('Tab');
  await symbol.focus();
  await expect(symbol).toBeFocused();
  expect(await symbol.evaluate(element => { const style = getComputedStyle(element); return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2; })).toBe(true);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('QF1');
  const unconnected = configured.data.devices.find(device => device.code === 'Q1')!;
  await svg.locator(`[data-device-id="${unconnected.id}"]`).click();
  await expect(page.getByLabel('Eszköz azonosítója', { exact: true })).toHaveValue('Q1');
  await page.getByRole('button', { name: 'Rajz illesztése', exact: true }).click();
  await page.screenshot({ path: path.resolve('tmp/singleline-review-screen.png'), fullPage: true });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG letöltése', exact: true }).click();
  await (await downloading).saveAs(path.resolve('tmp/singleline-review.png'));
  await page.reload();
  await reopenRecentProject(page);
  const reopened = await readDocument(page);
  expect(reopened.data.boards[0].wiring).toEqual(configured.data.boards[0].wiring);
  expect(reopened.data.circuits.slice(0, 2).map(circuit => circuit.boardConnections)).toEqual(configured.data.circuits.slice(0, 2).map(circuit => circuit.boardConnections));
});
