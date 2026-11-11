import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { chooseSample, reopenRecentProject } from './startup';

test('preserves and downloads temporary editor drawings without replacing the shared board', async ({ page }) => {
  const original = await readFile(path.join(process.cwd(), 'e2e/fixtures/kistarcsa-eloszto.json'), 'utf8');
  const snapshot = JSON.parse(original);
  await page.addInitScript(value => {
    localStorage.setItem('eloszto-tervezo-v2', value);
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      (window as Window & { exportedBlob?: Blob | MediaSource }).exportedBlob = blob;
      return create(blob);
    };
  }, original);
  await page.goto('/');
  await chooseSample(page);
  await page.evaluate(async value => {
    const id = localStorage.getItem('planner.activeProject');
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('villamos-tervezo-local');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('projects', 'readwrite');
        const store = tx.objectStore('projects');
        const get = store.get(id!);
        get.onsuccess = () => { const item = get.result; item.document.data.boardPlanner = value; store.put(item); };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, snapshot);
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await expect(page.getByText('A korábbi önálló rajz külön megmaradt', { exact: false })).toBeHidden();
  await page.locator('.workspace-toolbar').getByText('Korábbi rajzok', { exact:true }).click();
  await expect(page.getByText('A korábbi önálló rajz külön megmaradt', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Korábbi elosztónézet' })).toHaveCount(0);
  await expect(page.locator('iframe[title="Elosztótervező"]')).toHaveCount(0);
  const waitProject = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektben őrzött rajz letöltése' }).click();
  const download = await waitProject;
  expect(download.suggestedFilename()).toContain('korabbi-elosztoterv.json');
  expect(JSON.parse(await page.evaluate(() => ((window as Window & { exportedBlob: Blob }).exportedBlob).text()))).toEqual(snapshot);
  const waitBrowser = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Böngészőben őrzött rajz letöltése' }).click();
  expect((await waitBrowser).suggestedFilename()).toContain('korabbi-onallo-rajz.json');
  expect(await page.evaluate(() => ((window as Window & { exportedBlob: Blob }).exportedBlob).text())).toBe(original);
  await expect(page.getByRole('heading', { name:'Lakáselosztó', exact:true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('eloszto-tervezo-v2'))).toBe(original);
});
