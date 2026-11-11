import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const document = get.result.document; db.close(); resolve(document); };
      };
    });
  });
}

async function createSupply(page: Page) {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Betáplálás hozzáadása', exact: true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.infeeds.length).toBe(1);
}

test('moves supply with its grip and keyboard while preserving its connected wire, undo and reload', async ({ page }) => {
  await createSupply(page);
  await page.getByRole('button', { name:'Külső betáplálás · 1 (L)', exact:true }).click();
  await page.getByRole('button', { name:'QF1 · felső 1 (L)', exact:true }).click();
  await page.getByRole('button', { name:'Vezeték létrehozása', exact:true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.wires.length).toBe(1);
  const before = await readDocument(page);
  const originalWire = before.data.boards[0].wiring!.wires[0];
  const wire = page.locator('.wiring-wire-hit').first();
  const oldPath = await wire.getAttribute('points');
  const grip = page.getByRole('button', { name:'Betáplálás mozgatása: Külső betáplálás', exact:true });
  await grip.scrollIntoViewIfNeeded();
  const bounds = (await grip.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 65, bounds.y + bounds.height / 2 + 40, { steps:6 });
  await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toBeDefined();
  const moved = (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position!;
  await expect(wire).not.toHaveAttribute('points', oldPath!);
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0]).toEqual(originalWire);
  await page.getByRole('button', { name:'Visszavonás', exact:true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toBeUndefined();
  await page.getByRole('button', { name:'Újra', exact:true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toEqual(moved);
  await grip.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position!.x).toBeLessThan(moved.x);
  const finalPosition = (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position;
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await expect(grip).toBeVisible();
  expect((await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toEqual(finalPosition);
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0]).toEqual(originalWire);
});

test.describe('touch supply grip', () => {
  test.use({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  test('moves the supply by touch and persists its position', async ({ page }) => {
    await createSupply(page);
    const grip = page.getByRole('button', { name:'Betáplálás mozgatása: Külső betáplálás', exact:true });
    await grip.scrollIntoViewIfNeeded();
    const bounds = (await grip.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{ x,y }] });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x - 45,y:y + 35 }] });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] });
    await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toBeDefined();
    const moved = (await readDocument(page)).data.boards[0].wiring!.infeeds[0].position;
    await page.reload();
    await reopenRecentProject(page);
    expect((await readDocument(page)).data.boards[0].wiring!.infeeds[0].position).toEqual(moved);
    await cdp.detach();
  });
});
