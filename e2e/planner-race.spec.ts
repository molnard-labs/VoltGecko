import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';
import type { ProjectDocument } from '../src/types';

test('one circuit links the floor plan and cabinet, and its physical wire appears in the single-line drawing', async ({ page }) => {
  const readProject = () => page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id!);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { db.close(); resolve(get.result.document); };
      };
    });
  });
  const tab = (name: string) => page.locator('.view-tabs').getByRole('button', { name, exact: true }).click();
  await page.goto('/');
  await chooseSample(page);
  const initial = await readProject();
  const main = initial.data.devices.find(d => d.code === 'Q1')!;
  const breaker = initial.data.devices.find(d => d.code === 'QF1')!;
  const floorDevice = initial.data.devices.find(d => d.code === 'D1')!;
  const circuit = initial.data.circuits.find(c => c.protectionDeviceId === breaker.id)!;
  expect(floorDevice.circuitId).toBe(circuit.id);
  await tab('Áramkörök');
  await page.getByLabel(`${circuit.code} neve`, { exact: true }).fill('Közös próbaáramkör');
  await tab('Elosztó');
  await expect(page.getByRole('button', { name: 'Szekrényrajz', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('QF1 táplálása', { exact: true })).toHaveCount(0);
  await page.getByLabel('Vezeték kezdőpontja', { exact: true }).selectOption(JSON.stringify({ kind: 'device', deviceId: main.id, side: 'bottom', pole: 0 }));
  await page.getByLabel('Vezeték végpontja', { exact: true }).selectOption(JSON.stringify({ kind: 'device', deviceId: breaker.id, side: 'top', pole: 0 }));
  await page.getByRole('button', { name: 'Vezeték létrehozása', exact: true }).click();
  await expect.poll(async () => (await readProject()).data.boards[0].wiring?.wires.length).toBe(1);
  const saved = await readProject();
  const wireId = saved.data.boards[0].wiring!.wires[0].id;
  expect(saved.data.devices.find(d => d.id === floorDevice.id)?.circuitId).toBe(circuit.id);
  expect(saved.data.circuits.find(c => c.id === circuit.id)?.name).toBe('Közös próbaáramkör');
  await tab('Egyvonalas');
  await expect(page.locator(`.single-line-svg [data-connection-id="${wireId}"]`)).toHaveCount(1);
  await expect(page.locator('.single-line-svg')).toContainText('Közös próbaáramkör');
  await page.reload();
  await reopenRecentProject(page);
  await tab('Egyvonalas');
  await expect(page.locator(`.single-line-svg [data-connection-id="${wireId}"]`)).toHaveCount(1);
  expect((await readProject()).data.sheets).toEqual(initial.data.sheets);
});
