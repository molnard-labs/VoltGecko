import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function saved(page:Page):Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve,reject) => {
      const open = indexedDB.open('villamos-tervezo-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, request = db.transaction('projects','readonly').objectStore('projects').get(id);
        request.onerror = () => { db.close(); reject(request.error); };
        request.onsuccess = () => { const document = request.result.document; db.close(); resolve(document); };
      };
    });
  });
}

async function centerOfConnector(connector:Locator) {
  await connector.scrollIntoViewIfNeeded();
  return connector.locator('circle').nth(1).evaluate(element => {
    const circle = element as SVGCircleElement;
    const point = new DOMPoint(Number(circle.getAttribute('cx')),Number(circle.getAttribute('cy'))).matrixTransform(circle.getScreenCTM()!);
    return {x:point.x,y:point.y};
  });
}

test('compact circuit boxes keep individual connections and their saved routes while moving', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), circuit = initial.data.circuits[0], board = initial.data.boards[0];
  const breaker = initial.data.devices.find(device => device.code === 'QF1')!;
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram'), box = diagram.locator(`[data-circuit-id="${circuit.id}"]`);
  const rect = box.locator('rect').first(), l = box.locator('.wiring-circuit-connector[data-conductor="L"]');
  const next = box.locator('.wiring-circuit-connector').nth(1);
  await expect(box).toContainText(circuit.code); await expect(box).toContainText(circuit.name);
  expect(Number(await rect.getAttribute('width'))).toBeLessThan(200);
  const yL = Number(await l.locator('circle').nth(1).getAttribute('cy'));
  const yNext = Number(await next.locator('circle').nth(1).getAttribute('cy'));
  expect(yNext - yL).toBeGreaterThanOrEqual(16);
  expect(yNext - yL).toBeLessThanOrEqual(20);

  // Real clicks at the centers of adjacent conductors select different ports.
  let point = await centerOfConnector(l); await page.mouse.click(point.x,point.y);
  await expect(l).toHaveClass(/selected/);
  point = await centerOfConnector(next); await page.mouse.click(point.x,point.y);
  await expect(next).toHaveClass(/selected/); await expect(l).not.toHaveClass(/selected/);
  point = await centerOfConnector(l); await page.mouse.click(point.x,point.y);
  await expect(l).toHaveClass(/selected/);
  await diagram.getByRole('button',{name:'QF1 · alsó 1 (L)',exact:true}).click();
  const terminal = async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals.find(item => item.conductor === 'L');
  await expect.poll(terminal).toMatchObject({conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}});
  const wire = diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`), hit = wire.locator('.wiring-wire-hit');
  await hit.focus(); await hit.press('Enter');
  await page.getByRole('button',{name:'Töréspont hozzáadása',exact:true}).click();
  await expect.poll(async () => (await terminal())?.points?.length).toBeGreaterThan(0);
  const beforeMove = await terminal();
  const grip = box.getByRole('button',{name:/Áramkör mozgatása/});
  await grip.focus(); await grip.press('ArrowRight');
  await expect.poll(async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.position).toBeDefined();
  const moved = (await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.position;
  expect(await terminal()).toEqual(beforeMove);
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  expect(await terminal()).toEqual(beforeMove);
  expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.position).toEqual(moved);
  await expect(wire).toBeVisible();
});

test.describe('touch', () => {
  test.use({hasTouch:true,viewport:{width:700,height:950}});
  test('neighboring compact connectors remain individually tappable', async ({page}) => {
    await page.goto('/'); await chooseSample(page);
    const initial = await saved(page), circuit = initial.data.circuits[0];
    await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
    const box = page.locator(`.wiring-circuit[data-circuit-id="${circuit.id}"]`);
    const l = box.locator('.wiring-circuit-connector[data-conductor="L"]');
    const next = box.locator('.wiring-circuit-connector').nth(1);
    let point = await centerOfConnector(l); await page.touchscreen.tap(point.x,point.y);
    await expect(l).toHaveClass(/selected/);
    expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.flatMap(item => item.terminals) ?? []).toHaveLength(0);
    point = await centerOfConnector(next); await page.touchscreen.tap(point.x,point.y);
    await expect(next).toHaveClass(/selected/); await expect(l).not.toHaveClass(/selected/);
    point = await centerOfConnector(l); await page.touchscreen.tap(point.x,point.y);
    await expect(l).toHaveClass(/selected/);
    await page.locator('.wiring-diagram').getByRole('button',{name:'QF1 · alsó 1 (L)',exact:true}).tap();
    const breaker = initial.data.devices.find(item => item.code === 'QF1')!;
    await expect.poll(async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.flatMap(item => item.terminals) ?? []).toMatchObject([{conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}}]);
  });
});
