import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument, Route } from '../src/types';
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
  const position = await page.locator(selector).first().evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM()!;
    const point = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(position.x, position.y);
}
function orthogonal(route: Route) {
  return route.points.every((point, index) => !index || point.x === route.points[index - 1].x || point.y === route.points[index - 1].y);
}

test('connects a board to devices in either direction, keeps routes when moved and reloaded, and removes routes with the marker', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.getByRole('button', { name: 'Elosztó elhelyezése', exact: true }).click();
  await page.locator('.floor-svg').click({ position: { x: 420, y: 300 } });
  const marker = page.locator('.floor-board-marker');
  await expect(marker).toHaveCount(1);
  const initial = (await documentData(page)).data.sheets[0];
  const boardId = initial.boardPlacements![0].boardId;
  const deviceId = initial.placements[0].deviceId;
  const initialCount = initial.routes.length;

  await page.getByRole('button', { name: 'Kapcsolat / nyomvonal', exact: true }).click();
  await clickAtOrigin(page, '.floor-board-marker');
  await expect(page.getByRole('status').filter({ hasText: 'másik eszközét vagy elosztóját' })).toBeVisible();
  await clickAtOrigin(page, '.floor-device');
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.length).toBe(initialCount + 1);
  let sheet = (await documentData(page)).data.sheets[0];
  let power = sheet.routes.at(-1)!;
  expect(power).toMatchObject({ kind: 'power', fromBoardId: boardId, toDeviceId: deviceId });
  expect(orthogonal(power)).toBe(true);

  // A reversed duplicate is rejected, while another kind in the opposite direction is allowed.
  await clickAtOrigin(page, '.floor-device');
  await clickAtOrigin(page, '.floor-board-marker');
  await expect(page.getByText('Ez a kapcsolat már szerepel a tervlapon.')).toBeVisible();
  expect((await documentData(page)).data.sheets[0].routes.length).toBe(initialCount + 1);
  await page.getByRole('button', { name: 'Vezérlési kapcsolat', exact: true }).click();
  await clickAtOrigin(page, '.floor-device');
  await clickAtOrigin(page, '.floor-board-marker');
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.length).toBe(initialCount + 2);
  sheet = (await documentData(page)).data.sheets[0];
  expect(sheet.routes.at(-1)).toMatchObject({ kind: 'control', fromDeviceId: deviceId, toBoardId: boardId });

  await page.getByRole('button', { name: 'Kijelölés és mozgatás', exact: true }).click();
  const position = await marker.evaluate(element => {
    const matrix = (element as SVGGElement).getScreenCTM()!;
    const point = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x: point.x, y: point.y };
  });
  await page.mouse.move(position.x, position.y);
  await page.mouse.down();
  await page.mouse.move(position.x + 45, position.y + 35, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await documentData(page)).data.sheets[0].boardPlacements![0].x).not.toBe(initial.boardPlacements![0].x);
  sheet = (await documentData(page)).data.sheets[0];
  power = sheet.routes.find(route => route.fromBoardId === boardId)!;
  const control = sheet.routes.find(route => route.toBoardId === boardId)!;
  expect(power.points[0]).toEqual({ x: sheet.boardPlacements![0].x, y: sheet.boardPlacements![0].y });
  expect(control.points.at(-1)).toEqual({ x: sheet.boardPlacements![0].x, y: sheet.boardPlacements![0].y });
  expect(orthogonal(power)).toBe(true);
  expect(orthogonal(control)).toBe(true);

  await page.reload();
  await reopenRecentProject(page);
  sheet = (await documentData(page)).data.sheets[0];
  expect(sheet.routes.find(route => route.id === power.id)?.points).toEqual(power.points);
  expect(sheet.routes.find(route => route.id === control.id)?.points).toEqual(control.points);
  await marker.focus();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Kijelölt elem eltávolítása' }).click();
  await expect(marker).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Kijelölt elem eltávolítása' }).click();
  await expect(marker).toHaveCount(0);
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.some(route => route.fromBoardId === boardId || route.toBoardId === boardId)).toBe(false);
  expect((await documentData(page)).data.boards.some(board => board.id === boardId)).toBe(true);
});



test('connects two distribution boards on the same floor plan', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('Második elosztó'));
  await page.getByRole('button', { name: 'Új elosztó', exact: true }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
  await page.getByRole('button', { name: 'Elosztó elhelyezése', exact: true }).click();
  const options = page.getByLabel('Elhelyezendő elosztó');
  const firstId = await options.inputValue();
  await page.locator('.floor-svg').click({ position: { x: 360, y: 250 } });
  await page.getByRole('button', { name: 'Elosztó elhelyezése', exact: true }).click();
  await options.selectOption({ label: 'Második elosztó' });
  const secondId = await options.inputValue();
  await page.locator('.floor-svg').click({ position: { x: 510, y: 250 } });
  const count = (await documentData(page)).data.sheets[0].routes.length;
  await page.getByRole('button', { name: 'Kapcsolat / nyomvonal', exact: true }).click();
  await clickAtOrigin(page, '.floor-board-marker');
  await page.getByRole('button', { name: 'Elosztó kiválasztása kapcsolathoz: Második elosztó' }).press('Enter');
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.length).toBe(count + 1);
  const route = (await documentData(page)).data.sheets[0].routes.at(-1)!;
  expect(route).toMatchObject({ fromBoardId: firstId, toBoardId: secondId, kind: 'power' });
  expect(orthogonal(route)).toBe(true);
});
