import { expect, test, type Locator, type Page } from '@playwright/test';
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

async function visiblePointOnWire(line: Locator) {
  return line.evaluate(element => {
    const polyline = element as SVGPolylineElement;
    const points = Array.from(polyline.points);
    const segments: {first: DOMPoint, second: DOMPoint, length: number}[] = [];
    for (let i = 1; i < points.length; i++) {
      segments.push({first: points[i - 1], second: points[i], length: Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)});
    }
    segments.sort((a, b) => b.length - a.length);
    for (const {first, second} of segments) {
      for (const fraction of [0.5, 0.25, 0.75, 0.1, 0.9]) {
        const screen = new DOMPoint(first.x + (second.x - first.x) * fraction, first.y + (second.y - first.y) * fraction).matrixTransform(polyline.getScreenCTM()!);
        if (document.elementFromPoint(screen.x, screen.y) === polyline) return {x:screen.x, y:screen.y};
      }
    }
    throw new Error('No visible clickable point on the circuit wire');
  });
}

function expectOrthogonal(points: string | null) {
  expect(points).toBeTruthy();
  const coordinates = points!.trim().split(/\s+/).map(point => point.split(',').map(Number));
  for (let i = 1; i < coordinates.length; i++) {
    expect(coordinates[i][0] === coordinates[i - 1][0] || coordinates[i][1] === coordinates[i - 1][1]).toBe(true);
  }
}

test('circuit wire can be selected, reshaped orthogonally and retains its bends after reload', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), circuit = initial.data.circuits[0], board = initial.data.boards[0];
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram');
  await diagram.locator(`[data-circuit-id="${circuit.id}"]`).getByRole('button', {name:/^L · ÁK1.*áramköri végpont/}).click();
  await diagram.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true}).click();
  const wire = diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`);
  const hit = wire.locator('.wiring-wire-hit');
  await expect(hit).toBeVisible();
  await expect(page.locator('.wiring-heading .small-tag')).toHaveText('1 vezeték');
  await hit.scrollIntoViewIfNeeded();
  const start = await visiblePointOnWire(hit);
  await page.mouse.click(start.x, start.y);
  await expect(wire).toHaveClass(/selected/);
  const addBend = page.getByRole('button', {name:'Töréspont hozzáadása',exact:true});
  await expect(addBend).toBeVisible();
  const bends = page.locator('[data-testid^="wire-bend-"]');
  const before = await bends.count();
  await addBend.click();
  await expect(bends).toHaveCount(before + 1);
  const readPoints = async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals.find(item => item.conductor === 'L')?.points;
  await expect.poll(async () => (await readPoints())?.length).toBeGreaterThan(0);
  expectOrthogonal(await hit.getAttribute('points'));

  // The same Delete gesture as ordinary cabinet wires removes the selected bend.
  await bends.first().focus(); await bends.first().press('Enter'); await page.keyboard.press('Delete');
  await expect(bends).toHaveCount(before);
  expectOrthogonal(await hit.getAttribute('points'));

  // Drag a complete edge perpendicular to itself, then check the saved route.
  const segment = page.locator('[data-testid^="wire-segment-"]').first();
  await segment.scrollIntoViewIfNeeded();
  const drag = await segment.evaluate(element => {
    const line = element as SVGLineElement;
    const x1 = Number(line.getAttribute('x1')), y1 = Number(line.getAttribute('y1'));
    const x2 = Number(line.getAttribute('x2')), y2 = Number(line.getAttribute('y2'));
    const start = new DOMPoint((x1+x2)/2, (y1+y2)/2).matrixTransform(line.getScreenCTM()!);
    return {x:start.x,y:start.y,dx:y1===y2?0:30,dy:y1===y2?30:0};
  });
  const prior = await readPoints();
  await page.mouse.move(drag.x, drag.y); await page.mouse.down();
  await page.mouse.move(drag.x + drag.dx, drag.y + drag.dy, {steps:5}); await page.mouse.up();
  await expect.poll(readPoints).not.toEqual(prior);
  expectOrthogonal(await hit.getAttribute('points'));
  const edited = await readPoints();
  const expectedRoute = await hit.getAttribute('points');
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  await expect(wire).toBeVisible();
  expect(await readPoints()).toEqual(edited);
  await expect(hit).toHaveAttribute('points', expectedRoute!);

  // The detailed coordinate editor follows the same route as the diagram.
  await hit.focus(); await hit.press('Enter');
  const coordinate = page.getByLabel('1. töréspont x', {exact:true});
  await expect(coordinate).toBeVisible();
  await coordinate.fill(String(Number(await coordinate.inputValue()) + 30));
  await expect.poll(readPoints).not.toEqual(edited);
  expectOrthogonal(await hit.getAttribute('points'));
  const detailedPoints = await readPoints();
  const endpoint = (await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.terminals.find(item => item.conductor === 'L')!.endpoint;
  await page.getByRole('button', {name:'Nyomvonal alaphelyzetbe',exact:true}).click();
  await expect.poll(readPoints).toBeUndefined();
  expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.terminals.find(item => item.conductor === 'L')!.endpoint).toEqual(endpoint);
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect.poll(readPoints).toEqual(detailedPoints);
  expect((await saved(page)).data.circuits.find(item => item.id === circuit.id)!.boardConnections!.find(item => item.boardId === board.id)!.terminals.find(item => item.conductor === 'L')!.endpoint).toEqual(endpoint);
});

test('circuit wire endpoint can be reconnected, undone and deleted without deleting its circuit', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), circuit = initial.data.circuits[0], board = initial.data.boards[0];
  const qf1 = initial.data.devices.find(item => item.code === 'QF1')!;
  const qf2 = initial.data.devices.find(item => item.code === 'QF2')!;
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram');
  await diagram.locator(`[data-circuit-id="${circuit.id}"]`).getByRole('button', {name:/^L · ÁK1.*áramköri végpont/}).click();
  await diagram.getByRole('button', {name:'QF1 · alsó 1 (L)',exact:true}).click();
  const wire = diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`);
  const terminal = async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals.find(item => item.conductor === 'L');
  const oldEndpoint = {kind:'device', deviceId:qf1.id, side:'bottom', pole:0};
  const newEndpoint = {kind:'device', deviceId:qf2.id, side:'bottom', pole:0};
  await expect.poll(async () => (await terminal())?.endpoint).toEqual(oldEndpoint);
  const hit = wire.locator('.wiring-wire-hit');
  await hit.focus(); await hit.press('Enter');
  const handle = page.getByTestId('wire-endpoint-from');
  const target = diagram.getByRole('button', {name:'QF2 · alsó 1 (L)',exact:true}).locator('.wiring-terminal-hit');
  await target.scrollIntoViewIfNeeded(); await handle.scrollIntoViewIfNeeded();
  const a = await handle.boundingBox(), b = await target.boundingBox();
  if (!a || !b) throw new Error('Wire endpoint or target terminal is not visible');
  await page.mouse.move(a.x+a.width/2, a.y+a.height/2); await page.mouse.down();
  await page.mouse.move(b.x+b.width/2, b.y+b.height/2, {steps:8}); await page.mouse.up();
  await expect.poll(async () => (await terminal())?.endpoint).toEqual(newEndpoint);
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect.poll(async () => (await terminal())?.endpoint).toEqual(oldEndpoint);

  await hit.focus(); await hit.press('Enter');
  await page.getByRole('button', {name:'Kijelölt vezeték törlése',exact:true}).click();
  await expect.poll(terminal).toBeUndefined();
  expect((await saved(page)).data.circuits.some(item => item.id === circuit.id)).toBe(true);
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect.poll(async () => (await terminal())?.endpoint).toEqual(oldEndpoint);
});
