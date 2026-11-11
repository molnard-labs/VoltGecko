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
async function clickAtOrigin(page: Page, selector: string) {
  const point = await page.locator(selector).first().evaluate(element => {
    const matrix = (element as SVGGElement).getScreenCTM()!;
    const transformed = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y };
  });
  await page.mouse.click(point.x, point.y);
}

test('connects the unassigned floor circuit on the board drawing and reconnects it without adding cabinet wires', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Áramkörök', exact:true }).click();
  await page.getByRole('button', { name:'Új áramkör', exact:true }).click();
  await page.locator('.view-tabs').getByRole('button', { name:'Alaprajz', exact:true }).click();
  await page.getByRole('button', { name:'Elosztó elhelyezése', exact:true }).click();
  await page.locator('.floor-svg').click({ position:{x:420,y:300} });
  await page.getByRole('button', { name:'Kapcsolat / nyomvonal', exact:true }).click();
  await clickAtOrigin(page, '.floor-board-marker');
  await clickAtOrigin(page, '.floor-device');
  const initial = await documentData(page);
  const board = initial.data.boards[0];
  const route = initial.data.sheets[0].routes.find(item => item.fromBoardId === board.id)!;
  const breaker = initial.data.devices.find(item => item.code === 'QF1')!;
  const circuit = initial.data.circuits.find(item => item.code === 'ÁK4')!;
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await page.getByTestId('floor-board-route-card').getByLabel(/nyomvonal áramköre/).selectOption(circuit.id);
  const diagram = page.locator('.wiring-diagram');
  const floorRoute = diagram.locator(`[data-floor-route-id="${route.id}"]`);
  const l = floorRoute.getByRole('button', { name:/^L · .*alaprajzi végpont/ });
  const pe = floorRoute.getByRole('button', { name:/^PE · .*alaprajzi végpont/ });
  const breakerBottom = diagram.getByRole('button', { name:'QF1 · alsó 1 (L)', exact:true });
  const breakerTop = diagram.getByRole('button', { name:'QF1 · felső 1 (L)', exact:true });
  await expect(l).toBeVisible();
  await expect(pe).toBeVisible();
  await l.focus();
  await l.press('Enter');
  await expect(page.getByRole('status').filter({hasText:'Kiválasztott alaprajzi vezető: L'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('status').filter({hasText:'Kiválasztott alaprajzi vezető: L'})).toHaveCount(0);
  await pe.click();
  await breakerBottom.click();
  await expect(page.getByRole('alert').filter({hasText:'nem ehhez az elosztóhoz vagy vezetőhöz'})).toBeVisible();
  await page.keyboard.press('Escape');
  await l.click();
  await breakerBottom.click();
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(item => item.id === route.id)?.boardTerminals).toEqual([
    {boardId:board.id,conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}}
  ]);
  await expect(diagram.locator(`[data-floor-route-link="${route.id}"][data-conductor="L"]`)).toBeVisible();
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item => item.id === circuit.id)?.protectionDeviceId).toBe(breaker.id);
  expect((await documentData(page)).data.boards[0].wiring?.wires ?? []).toHaveLength(0);
  // The other click order is also supported, and reconnects the same conductor.
  await breakerTop.click();
  await l.click();
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(item => item.id === route.id)?.boardTerminals?.[0].endpoint).toEqual({kind:'device',deviceId:breaker.id,side:'top',pole:0});
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await expect(diagram.locator(`[data-floor-route-link="${route.id}"][data-conductor="L"]`)).toBeVisible();
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(item => item.id === route.id)?.boardTerminals?.[0].endpoint).toEqual({kind:'device',deviceId:breaker.id,side:'top',pole:0});
  await page.locator('.view-tabs').getByRole('button', { name:'Áramkörök', exact:true }).click();
  await expect(page.getByLabel('ÁK4 védelme', { exact:true })).toHaveValue(breaker.id);
});
