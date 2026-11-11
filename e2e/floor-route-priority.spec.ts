import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument, Route } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const open = indexedDB.open('villamos-tervezo-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const document = get.result.document; db.close(); resolve(document); };
      };
    });
  });
}

async function pointOnCanvas(page: Page, x: number, y: number) {
  return page.locator('.floor-svg').evaluate((element, point) => {
    const transformed = new DOMPoint(point.x, point.y).matrixTransform((element as SVGSVGElement).getScreenCTM()!);
    return { x: transformed.x, y: transformed.y };
  }, { x, y });
}

function orthogonal(route: Route) {
  return route.points.every((point, index) => !index || point.x === route.points[index - 1].x || point.y === route.points[index - 1].y);
}

test('selected nearby route and bend keep pointer priority without trapping route or device selection', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await expect.poll(async () => (await readDocument(page)).data.sheets.length).toBeGreaterThan(0);
  // Set up reproducible geometry in a stored project, then reopen through the UI.
  await page.reload();
  await page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('villamos-tervezo-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
        const get = store.get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const row = get.result, data = row.document.data, sheet = data.sheets[0];
          const d1 = data.devices.find((device: { code: string }) => device.code === 'D1').id;
          const d2 = data.devices.find((device: { code: string }) => device.code === 'D2').id;
          sheet.routes = [
            { id:'near-a', fromDeviceId:d1, toDeviceId:d2, kind:'power', points:[{x:145,y:360},{x:250,y:360},{x:250,y:130},{x:470,y:130}] },
            { id:'near-b', fromDeviceId:d1, toDeviceId:d2, kind:'control', points:[{x:145,y:360},{x:258,y:360},{x:258,y:200},{x:350,y:200},{x:350,y:130},{x:470,y:130}] },
          ];
          store.put(row);
        };
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  });
  await reopenRecentProject(page);
  // Select A at a unique point above B's nearby vertical segment.
  let at = await pointOnCanvas(page, 250, 165);
  await page.mouse.click(at.x, at.y);
  const first = page.locator('.floor-route[data-route-id="near-a"]');
  const second = page.locator('.floor-route[data-route-id="near-b"]');
  await expect(first.locator('.floor-bend')).toHaveCount(2);
  await expect(page.locator('.floor-route').last()).toHaveAttribute('data-route-id', 'near-a');

  // Both 18-unit hit regions cover this coordinate; A must get the segment drag.
  at = await pointOnCanvas(page, 250, 280);
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.floor-route')?.getAttribute('data-route-id'), at)).toBe('near-a');
  const before = (await readDocument(page)).data.sheets[0].routes;
  await page.mouse.move(at.x, at.y); await page.mouse.down();
  await page.mouse.move(at.x + 24, at.y, { steps:5 }); await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].routes[0].points).not.toEqual(before[0].points);
  let routes = (await readDocument(page)).data.sheets[0].routes;
  expect(routes[1].points).toEqual(before[1].points);
  expect(orthogonal(routes[0])).toBe(true);
  expect(routes[0].points[0]).toEqual(before[0].points[0]);
  expect(routes[0].points.at(-1)).toEqual(before[0].points.at(-1));

  // The selected route's bends must also remain above B's hit path.
  const bend = first.locator('.floor-bend').first();
  const target = await bend.boundingBox();
  if (!target) throw new Error('Missing selected bend');
  const old = routes[0].points;
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2 + 18, target.y + target.height / 2 - 12, { steps:5 }); await page.mouse.up();
  await expect.poll(async () => (await readDocument(page)).data.sheets[0].routes[0].points).not.toEqual(old);
  routes = (await readDocument(page)).data.sheets[0].routes;
  expect(routes[1].points).toEqual(before[1].points);
  expect(orthogonal(routes[0])).toBe(true);

  // A different route is selectable directly where it has its own visible segment.
  at = await pointOnCanvas(page, 350, 165);
  await page.mouse.click(at.x, at.y);
  await expect(second.locator('.floor-bend')).toHaveCount(4);
  await expect(page.locator('.floor-route').last()).toHaveAttribute('data-route-id', 'near-b');
  // Elements in higher layers remain selectable even at a route endpoint.
  await page.locator('.floor-device').filter({ has:page.locator('text', { hasText:/^D1$/ }) }).click();
  await expect(page.getByLabel('Eszköz azonosítója')).toHaveValue('D1');
});
