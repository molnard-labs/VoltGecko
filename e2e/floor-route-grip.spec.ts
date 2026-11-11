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
test('moves a circuit with its handle and keeps its connection, undo and saved position', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page);
  const boardId = initial.data.boards[0].id, circuitId = initial.data.circuits[0].id;
  const position = async () => (await saved(page)).data.circuits.find(circuit => circuit.id === circuitId)?.boardConnections?.find(item => item.boardId === boardId)?.position;
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram');
  const route = diagram.locator(`[data-circuit-id="${circuitId}"]`);
  const l = route.getByRole('button', {name:/^L · .*áramköri végpont/});
  await l.click(); await diagram.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true}).click();
  const wire = diagram.locator(`[data-circuit-link="${circuitId}"][data-conductor="L"] polyline`).first();
  const before = await wire.getAttribute('points');
  const grip = route.getByRole('button', {name:/Áramkör mozgatása:/});
  await grip.scrollIntoViewIfNeeded();
  const box = await grip.boundingBox(); expect(box).not.toBeNull();
  const start = {x:box!.x + box!.width/2,y:box!.y + box!.height/2};
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x + 90,start.y - 30,{steps:6}); await page.mouse.up();
  await expect.poll(position).toBeDefined();
  const moved = (await position())!;
  await expect(wire).not.toHaveAttribute('points',before!);
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect.poll(position).toBeUndefined();
  await page.getByRole('button', {name:'Újra',exact:true}).click();
  await expect.poll(position).toEqual(moved);
  await grip.focus(); await grip.press('ArrowRight');
  await expect.poll(async () => (await position())?.x).toBeGreaterThan(moved.x);
  const keyed = (await position())!;
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  await expect.poll(position).toEqual(keyed);
  await expect(diagram.locator(`[data-circuit-link="${circuitId}"][data-conductor="L"]`)).toBeVisible();
  await expect(l).toBeVisible();
});

test.describe('touch circuit grip', () => {
  test.use({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  test('moves a circuit by touch and keeps its connector usable', async ({page}) => {
    await page.goto('/'); await chooseSample(page);
    const initial = await saved(page), boardId = initial.data.boards[0].id, circuitId = initial.data.circuits[0].id;
    const connection = async () => (await saved(page)).data.circuits.find(circuit => circuit.id === circuitId)?.boardConnections?.find(item => item.boardId === boardId);
    await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).tap();
    const route = page.locator(`.wiring-diagram [data-circuit-id="${circuitId}"]`);
    const grip = route.getByRole('button', {name:/Áramkör mozgatása:/});
    await grip.scrollIntoViewIfNeeded();
    const bounds = (await grip.boundingBox())!, x = bounds.x + bounds.width/2, y = bounds.y + bounds.height/2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:x - 40,y:y - 35}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await expect.poll(async () => (await connection())?.position).toBeDefined();
    const moved = (await connection())!.position;
    const connector = route.getByRole('button', {name:/^L · .*áramköri végpont/});
    await connector.scrollIntoViewIfNeeded();
    const hit = connector.locator('circle').first();
    const hitBounds = (await hit.boundingBox())!, hx = hitBounds.x + hitBounds.width/2, hy = hitBounds.y + hitBounds.height/2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:hx,y:hy}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:hx+12,y:hy}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await expect(page.getByRole('status').filter({hasText:'Kiválasztott áramköri vezető: L'})).toHaveCount(0);
    await hit.tap();
    await expect(page.getByRole('status').filter({hasText:'Kiválasztott áramköri vezető: L'})).toBeVisible();
    const breaker = page.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true});
    await breaker.scrollIntoViewIfNeeded(); await breaker.locator('circle').first().tap();
    await expect.poll(async () => (await connection())?.terminals.length).toBe(1);
    await page.reload(); await reopenRecentProject(page);
    await expect.poll(async () => (await connection())?.position).toEqual(moved);
    await cdp.detach();
  });
});
