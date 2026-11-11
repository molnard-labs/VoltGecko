import { expect, test, type Page } from '@playwright/test';
import { decodeProject } from '../src/data/archive';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

interface MemoryProjectFile {
  bytes: Blob;
  writes: number;
  pickerCalls: number;
  pickerReturned: boolean;
  releasePicker?: () => void;
}
declare global { interface Window { __linkedFileTest: MemoryProjectFile } }

async function installPicker(page: Page, pending = false) {
  await page.addInitScript(holdPicker => {
    const state: MemoryProjectFile = { bytes: new Blob(), writes: 0, pickerCalls: 0, pickerReturned: false };
    window.__linkedFileTest = state;
    const handle = {
      name: 'linked-project.vgecko',
      async getFile() { return state.bytes; },
      async createWritable() {
        let staged: Blob | undefined;
        return {
          async write(value: Blob) { staged = value; },
          async close() { if (!staged) throw new Error('No staged archive'); state.bytes = staged; state.writes++; },
          async abort() { staged = undefined; },
        };
      },
    };
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        state.pickerCalls++;
        if (holdPicker) await new Promise<void>(resolve => { state.releasePicker = resolve; });
        state.pickerReturned = true;
        return handle;
      },
    });
  }, pending);
}

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(() => {
    const id = localStorage.getItem('planner.activeProject');
    if (!id) throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const read = database.transaction('projects', 'readonly').objectStore('projects').get(id);
        read.onerror = () => { database.close(); reject(read.error); };
        read.onsuccess = () => {
          database.close();
          if (!read.result?.document) reject(new Error('Missing saved project'));
          else resolve(read.result.document);
        };
      };
    });
  });
}

async function readLinkedArchive(page: Page): Promise<ProjectDocument> {
  const bytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__linkedFileTest.bytes.arrayBuffer())));
  return decodeProject(new Blob([new Uint8Array(bytes).buffer]));
}

async function openPlanner(page: Page, pending = false) {
  await installPicker(page, pending);
  await page.goto('/');
  await chooseSample(page);
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mentés és export', exact: false })).toBeVisible();
}

async function connectFile(page: Page) {
  await page.getByRole('button', { name: 'Mentés és export', exact: false }).click();
  await page.getByRole('button', { name: /^Automatikus mentés fájlba…/ }).click();
}

async function selectFirstDevice(page: Page) {
  await page.locator('.device-list').getByRole('button', { name: 'D1 Dugalj Nappali', exact: true }).click();
}

test('writes complete linked archives after edits while preserving local autosave, assets and history', async ({ page }) => {
  await openPlanner(page);
  const original = await readDocument(page);
  expect(Object.keys(original.assets).length).toBeGreaterThan(0);
  expect(original.revisions.length).toBeGreaterThan(0);
  await connectFile(page);
  await expect(page.locator('.linked-file-control [role="status"]')).toHaveText('Fájlba mentve: linked-project.vgecko');
  expect(await readLinkedArchive(page)).toEqual(original);
  const initialWrites = await page.evaluate(() => window.__linkedFileTest.writes);

  await selectFirstDevice(page);
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Fájlba és helyben mentett dugalj');
  await page.getByLabel('Eszköz megjegyzése', { exact: true }).fill('Kapcsolt fájl – teljes mentés');
  await page.locator('.save-version-button').click();
  await expect.poll(async () => (await readLinkedArchive(page)).data.devices.find(device => device.code === 'D1')?.name).toBe('Fájlba és helyben mentett dugalj');
  await expect.poll(async () => (await readLinkedArchive(page)).revisions.length).toBe(original.revisions.length + 1);
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.code === 'D1')?.notes).toBe('Kapcsolt fájl – teljes mentés');
  const saved = await readDocument(page), archive = await readLinkedArchive(page);
  expect(archive).toEqual(saved);
  expect(archive.assets).toEqual(original.assets);
  expect(archive.revisions[0]).toEqual(original.revisions[0]);
  expect(await page.evaluate(() => window.__linkedFileTest.writes)).toBeGreaterThan(initialWrites);

  await page.reload();
  await reopenRecentProject(page);
  expect(await readDocument(page)).toEqual(saved);
  await page.getByRole('button', { name: 'Mentés és export', exact: false }).click();
  await expect(page.getByRole('button', { name: /^Automatikus mentés fájlba…/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fájl leválasztása', exact: true })).toHaveCount(0);
});

test('pauses on an external file edit without overwriting it and continues local autosave', async ({ page }) => {
  await openPlanner(page);
  await connectFile(page);
  await expect(page.locator('.linked-file-control [role="status"]')).toHaveText('Fájlba mentve: linked-project.vgecko');
  const writesBeforeExternalEdit = await page.evaluate(() => {
    const state = window.__linkedFileTest;
    state.bytes = new Blob(['Externally changed bytes – preserve this file']);
    return state.writes;
  });
  await selectFirstDevice(page);
  await page.getByLabel('Eszköz neve', { exact: true }).fill('Külső ütközés mellett is helyben mentve');
  await expect(page.locator('.linked-file-control [role="status"]')).toHaveText('Fájlmentés szünetel');
  await expect(page.locator('.toast')).toContainText('A kapcsolt fájl kívülről megváltozott');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.code === 'D1')?.name).toBe('Külső ütközés mellett is helyben mentve');
  await page.getByLabel('Eszköz megjegyzése', { exact: true }).fill('Szünetelő fájlmentés után további helyi módosítás');
  await expect.poll(async () => (await readDocument(page)).data.devices.find(device => device.code === 'D1')?.notes).toBe('Szünetelő fájlmentés után további helyi módosítás');
  // Pass the 650 ms external-save debounce after the last edit as well.
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__linkedFileTest.bytes.text())).toBe('Externally changed bytes – preserve this file');
  expect(await page.evaluate(() => window.__linkedFileTest.writes)).toBe(writesBeforeExternalEdit);
  const local = await readDocument(page);
  await page.reload();
  await reopenRecentProject(page);
  expect(await readDocument(page)).toEqual(local);
});

test('cancels a pending picker when switching projects and never writes the previous project', async ({ page }) => {
  await openPlanner(page, true);
  const previous = await readDocument(page);
  await connectFile(page);
  await expect.poll(() => page.evaluate(() => window.__linkedFileTest.pickerCalls)).toBe(1);
  await page.locator('.project-switch').click();
  await page.getByRole('button', { name: 'Új projekt', exact: true }).click();
  await page.getByLabel('Projekt neve', { exact: true }).fill('Másik projekt a fájlválasztás közben');
  await page.getByRole('button', { name: 'Projekt létrehozása', exact: true }).click();
  await expect(page.locator('.project-switch strong')).toHaveText('Másik projekt a fájlválasztás közben');
  expect((await readDocument(page)).data.id).not.toBe(previous.data.id);
  await page.evaluate(() => window.__linkedFileTest.releasePicker?.());
  await expect.poll(() => page.evaluate(() => window.__linkedFileTest.pickerReturned)).toBe(true);
  await page.getByRole('button', { name: 'Mentés és export', exact: false }).click();
  await expect(page.getByRole('button', { name: /^Automatikus mentés fájlba…/ })).toBeEnabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Projektbeállítások', exact: true }).click();
  await page.getByLabel('Helyszín', { exact: true }).fill('Az új projekt helyi mentése működik');
  await page.getByRole('button', { name: 'Kész', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.site).toBe('Az új projekt helyi mentése működik');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.__linkedFileTest.writes)).toBe(0);
  expect(await page.evaluate(() => window.__linkedFileTest.bytes.size)).toBe(0);
  await expect(page.getByRole('button', { name: 'Fájl leválasztása', exact: true })).toHaveCount(0);
});
