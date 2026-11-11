import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function saved(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const doc = get.result.document; db.close(); resolve(doc); };
      };
    });
  });
}

async function clickAtOrigin(page: Page, selector: string) {
  const point = await page.locator(selector).first().evaluate(element => {
    const transformed = new DOMPoint(0, 0).matrixTransform((element as SVGGElement).getScreenCTM()!);
    return {x:transformed.x,y:transformed.y};
  });
  await page.mouse.click(point.x,point.y);
}

test('renders each circuit independently of floor routes, connects its left terminal and saves its position', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page);
  const circuit = initial.data.circuits[0], board = initial.data.boards[0];
  const breaker = initial.data.devices.find(device => device.code === 'QF1')!;
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram');
  const box = diagram.locator(`[data-circuit-id="${circuit.id}"]`);
  await expect(diagram.locator('.wiring-circuit')).toHaveCount(initial.data.circuits.length);
  await expect(diagram.locator('.wiring-floor-route')).toHaveCount(0);
  await expect(box).toHaveCount(1);
  const connector = box.getByRole('button', {name:/^L · ÁK1.*áramköri végpont/});
  const rect = box.locator('rect').first();
  const terminalCircle = connector.locator('circle').nth(1);
  expect(Number(await terminalCircle.getAttribute('cx'))).toBe(Number(await rect.getAttribute('x')));
  await connector.click();
  await diagram.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals).toEqual([
    {conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}}
  ]);
  await expect(diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`)).toBeVisible();
  const grip = box.getByRole('button', {name:/Áramkör mozgatása/});
  await grip.scrollIntoViewIfNeeded();
  const handle = (await grip.boundingBox())!;
  const link = diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"] polyline`).first();
  const originalLine = await link.getAttribute('points');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 60, handle.y + handle.height / 2 + 45, {steps:5});
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.position).toBeDefined();
  await expect(link).not.toHaveAttribute('points', originalLine!);
  await grip.focus(); await grip.press('ArrowLeft');
  const moved = (await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.position;
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  await expect(diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`)).toBeVisible();
  expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.position).toEqual(moved);

  // A floor route is only drawing geometry: deleting it must not remove the
  // cabinet's independently stored circuit and physical terminal assignment.
  await page.locator('.view-tabs').getByRole('button', {name:'Alaprajz',exact:true}).click();
  await page.getByRole('button', {name:'Elosztó elhelyezése',exact:true}).click();
  await page.locator('.floor-svg').click({position:{x:420,y:300}});
  await page.getByRole('button', {name:'Kapcsolat / nyomvonal',exact:true}).click();
  await clickAtOrigin(page,'.floor-board-marker'); await clickAtOrigin(page,'.floor-device');
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.length).toBe(initial.data.sheets[0].routes.length + 1);
  await page.getByRole('button', {name:'Kijelölt elem eltávolítása',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.length).toBe(initial.data.sheets[0].routes.length);
  expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.terminals).toEqual([
    {conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}}
  ]);
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  await expect(diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`)).toBeVisible();
});
