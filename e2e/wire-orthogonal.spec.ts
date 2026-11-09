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
        const db = open.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { const value = get.result.document; db.close(); resolve(value); };
      };
    });
  });
}

async function routePoints(page: Page) {
  const attribute = await page.locator('.wiring-wire.selected .wiring-wire-hit').getAttribute('points');
  return attribute!.trim().split(/\s+/).map(value => value.split(',').map(Number));
}

function expectOrthogonal(points: number[][]) {
  for (let index = 1; index < points.length; index++)
    expect(points[index][0] === points[index - 1][0] || points[index][1] === points[index - 1][1]).toBe(true);
}

test('moves orthogonal segments and bends, deletes only selected bends, and keeps routes after reload', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  const data = (await documentData(page)).data;
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  const main = data.devices.find(item => item.code === 'Q1')!, other = data.devices.find(item => item.code === 'QF1')!;
  const endpoint = (deviceId: string) => JSON.stringify({ kind:'device', deviceId, side:'top', pole:0 });
  await page.getByLabel('Vezeték kezdőpontja', { exact:true }).selectOption(endpoint(main.id));
  await page.getByLabel('Vezeték végpontja', { exact:true }).selectOption(endpoint(other.id));
  await page.getByRole('button', { name:'Vezeték létrehozása', exact:true }).click();
  await expect(page.getByRole('button', { name:'Töréspont hozzáadása', exact:true })).toBeVisible();
  const beforeAdd = await page.locator('[data-testid^="wire-bend-"]').count();
  await page.getByRole('button', { name:'Töréspont hozzáadása', exact:true }).click();
  await expect(page.locator('[data-testid^="wire-bend-"]')).toHaveCount(beforeAdd + 1);
  const beforeDelete = await routePoints(page);
  // Keyboard focus in a text field must not delete a bend.
  await page.getByTestId('wire-bend-0').click();
  const label = page.getByLabel('Vezeték felirata', { exact:true });
  await label.fill('Próba'); await label.press('Home'); await label.press('Delete');
  await expect(label).toHaveValue('róba');
  expect(await routePoints(page)).toEqual(beforeDelete);
  // Select a bend and remove it with Delete; no endpoint changes.
  const lastBend = page.locator('[data-testid^="wire-bend-"]').last();
  await lastBend.click(); await page.keyboard.press('Delete');
  await expect.poll(async () => (await routePoints(page)).length).toBeLessThan(beforeDelete.length);
  let points = await routePoints(page); expectOrthogonal(points);
  expect(points[0]).toEqual(beforeDelete[0]); expect(points.at(-1)).toEqual(beforeDelete.at(-1));
  // Segment dragging changes only the perpendicular coordinate and remains orthogonal.
  const segment = page.locator('[data-testid^="wire-segment-"]').nth(1);
  await segment.evaluate(element => element.scrollIntoView({ block:'center', inline:'center' }));
  const geometry = await segment.evaluate(element => {
    const line = element as SVGLineElement, matrix = line.ownerSVGElement!.getScreenCTM()!;
    const a = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(matrix);
    const b = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(matrix);
    return { x:(a.x+b.x)/2, y:(a.y+b.y)/2, horizontal:Math.abs(a.y-b.y)<1 };
  });
  const beforeSegment = await routePoints(page);
  await page.mouse.move(geometry.x, geometry.y); await page.mouse.down();
  await page.mouse.move(geometry.x + (geometry.horizontal ? 0 : 35), geometry.y + (geometry.horizontal ? 35 : 0), { steps:5 });
  await page.mouse.up();
  await expect.poll(async () => await routePoints(page)).not.toEqual(beforeSegment);
  points = await routePoints(page); expectOrthogonal(points);
  expect(points[0]).toEqual(beforeSegment[0]); expect(points.at(-1)).toEqual(beforeSegment.at(-1));
  // Disabling snap does not allow diagonal routing.
  await page.getByRole('button', { name:'Rácshoz illesztés' }).click();
  const bend = page.getByTestId('wire-bend-0'); await bend.scrollIntoViewIfNeeded();
  const box = await bend.boundingBox(); if (!box) throw new Error('No bend');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 23, box.y + box.height / 2 + 17, { steps:5 }); await page.mouse.up();
  expectOrthogonal(await routePoints(page));
  const saved = (await documentData(page)).data.boards[0].wiring!.wires[0].points;
  await page.reload(); await reopenRecentProject(page); await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  expect((await documentData(page)).data.boards[0].wiring!.wires[0].points).toEqual(saved);
});
