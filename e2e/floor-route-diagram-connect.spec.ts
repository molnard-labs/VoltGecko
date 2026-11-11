import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function documentData(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const open = indexedDB.open('villamos-tervezo-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const doc = get.result.document; db.close(); resolve(doc); };
      };
    });
  });
}
test('connects the unassigned circuit on the board drawing and reconnects it without adding cabinet wires', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Áramkörök', exact:true }).click();
  await page.getByRole('button', { name:'Új áramkör', exact:true }).click();
  const initial = await documentData(page);
  const board = initial.data.boards[0];
  const breaker = initial.data.devices.find(item => item.code === 'QF1')!;
  const circuit = initial.data.circuits.find(item => item.code === 'ÁK4')!;
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  const diagram = page.locator('.wiring-diagram');
  const box = diagram.locator(`[data-circuit-id="${circuit.id}"]`);
  const l = box.getByRole('button', { name:/^L · .*áramköri végpont/ });
  const pe = box.getByRole('button', { name:/^PE · .*áramköri végpont/ });
  const breakerBottom = diagram.getByRole('button', { name:'QF1 · alsó 1 (L)', exact:true });
  const breakerTop = diagram.getByRole('button', { name:'QF1 · felső 1 (L)', exact:true });
  await expect(l).toBeVisible();
  await expect(pe).toBeVisible();
  await l.focus();
  await l.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'Kiválasztott áramköri vezető: L'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({hasText:'Kiválasztott áramköri vezető: L'})).toHaveCount(0);
  await pe.locator('circle').first().click();
  await breakerBottom.click();
  await expect(page.getByRole('alert').filter({hasText:'nem ehhez az elosztóhoz vagy vezetőhöz'})).toBeVisible();
  await page.keyboard.press('Escape');
  await l.locator('circle').first().click();
  await breakerBottom.click();
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals).toEqual([
    {conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}}
  ]);
  await expect(diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`)).toBeVisible();
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item => item.id === circuit.id)?.protectionDeviceId).toBe(breaker.id);
  expect((await documentData(page)).data.boards[0].wiring?.wires ?? []).toHaveLength(0);
  // The other click order is also supported, and reconnects the same conductor.
  await breakerTop.click();
  await l.locator('circle').first().click();
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals[0].endpoint).toEqual({kind:'device',deviceId:breaker.id,side:'top',pole:0});
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await expect(diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`)).toBeVisible();
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals[0].endpoint).toEqual({kind:'device',deviceId:breaker.id,side:'top',pole:0});
  await page.locator('.view-tabs').getByRole('button', { name:'Áramkörök', exact:true }).click();
  await expect(page.getByLabel('ÁK4 védelme', { exact:true })).toContainText('QF1 · felső 1 (L)');
});
