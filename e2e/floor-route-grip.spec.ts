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
    const value = new DOMPoint(0, 0).matrixTransform((element as SVGGElement).getScreenCTM()!);
    return {x:value.x,y:value.y};
  });
  await page.mouse.click(point.x, point.y);
}

test('moves a floor circuit with its handle and keeps its connection, undo and saved position', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  await page.getByRole('button', {name:'Elosztó elhelyezése',exact:true}).click();
  await page.locator('.floor-svg').click({position:{x:420,y:300}});
  await page.getByRole('button', {name:'Kapcsolat / nyomvonal',exact:true}).click();
  await clickAtOrigin(page,'.floor-board-marker'); await clickAtOrigin(page,'.floor-device');
  const initial = await saved(page);
  const sheet = initial.data.sheets[0], boardId = sheet.boardPlacements![0].boardId;
  const routeId = sheet.routes.find(route => route.fromBoardId === boardId)!.id;
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram');
  const route = diagram.locator(`[data-floor-route-id="${routeId}"]`);
  const l = route.getByRole('button', {name:/^L · .*alaprajzi végpont/});
  await l.click(); await diagram.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true}).click();
  const wire = diagram.locator(`[data-floor-route-link="${routeId}"][data-conductor="L"] polyline`).first();
  const before = await wire.getAttribute('points');
  const grip = route.getByRole('button', {name:/Áramkör mozgatása:/});
  const box = await grip.boundingBox(); expect(box).not.toBeNull();
  const start = {x:box!.x + box!.width/2,y:box!.y + box!.height/2};
  await page.mouse.move(start.x,start.y); await page.mouse.down();
  await page.mouse.move(start.x + 90,start.y - 30,{steps:6}); await page.mouse.up();
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.length).toBe(1);
  const moved = (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)!.boardPositions![0];
  expect(moved.boardId).toBe(boardId);
  await expect(wire).not.toHaveAttribute('points',before!);
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions).toBeUndefined();
  await page.getByRole('button', {name:'Újra',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.[0]).toEqual(moved);
  await grip.focus(); await grip.press('ArrowRight');
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.[0].x).toBeGreaterThan(moved.x);
  const keyed = (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)!.boardPositions![0];
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.[0]).toEqual(keyed);
  await expect(diagram.locator(`[data-floor-route-link="${routeId}"][data-conductor="L"]`)).toBeVisible();
  await expect(l).toBeVisible();
});

test.describe('touch circuit grip', () => {
  test.use({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  test('moves a circuit by touch and keeps its connector usable', async ({page}) => {
    await page.goto('/'); await chooseSample(page);
    await page.getByRole('button', {name:'Elosztó elhelyezése',exact:true}).tap();
    await page.locator('.floor-svg').tap({position:{x:180,y:160}});
    await page.getByRole('button', {name:'Kapcsolat / nyomvonal',exact:true}).tap();
    await clickAtOrigin(page,'.floor-board-marker'); await clickAtOrigin(page,'.floor-device');
    const initial = await saved(page), sheet = initial.data.sheets[0], boardId = sheet.boardPlacements![0].boardId;
    const routeId = sheet.routes.find(item => item.fromBoardId === boardId)!.id;
    await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).tap();
    const route = page.locator(`.wiring-diagram [data-floor-route-id="${routeId}"]`);
    const grip = route.getByRole('button', {name:/Áramkör mozgatása:/});
    await grip.scrollIntoViewIfNeeded();
    const bounds = (await grip.boundingBox())!, x = bounds.x + bounds.width/2, y = bounds.y + bounds.height/2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:x - 40,y:y - 35}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.length).toBe(1);
    const moved = (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)!.boardPositions![0];
    const connector = route.getByRole('button', {name:/^L · .*alaprajzi végpont/});
    await connector.scrollIntoViewIfNeeded();
    const hit = connector.locator('circle').first();
    const hitBounds = (await hit.boundingBox())!, hx = hitBounds.x + hitBounds.width/2, hy = hitBounds.y + hitBounds.height/2;
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:hx,y:hy}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:hx+12,y:hy}]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await expect(page.getByRole('status').filter({hasText:'Kiválasztott alaprajzi vezető: L'})).toHaveCount(0);
    await hit.tap();
    await expect(page.getByRole('status').filter({hasText:'Kiválasztott alaprajzi vezető: L'})).toBeVisible();
    const breaker = page.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true});
    await breaker.scrollIntoViewIfNeeded(); await breaker.locator('circle').first().tap();
    await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardTerminals?.length).toBe(1);
    await page.reload(); await reopenRecentProject(page);
    await expect.poll(async () => (await saved(page)).data.sheets[0].routes.find(item => item.id === routeId)?.boardPositions?.[0]).toEqual(moved);
    await cdp.detach();
  });
});
