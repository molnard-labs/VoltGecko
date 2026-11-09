import { expect, test, type Locator, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    if (!id) throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { db.close(); if (!get.result?.document) reject(new Error('No saved document')); else resolve(get.result.document); };
      };
    });
  });
}

async function drag(page: Page, from: Locator, to: Locator) {
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = await from.boundingBox(), b = await to.boundingBox();
  if (!a || !b) throw new Error('Wire endpoint or terminal is not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('reconnects a selected wire by dragging, preserves invalid drops and validates the keyboard selectors', async ({ page }) => {
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await page.getByRole('button', { name:'Sín hozzáadása', exact:true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring?.buses.length).toBe(1);
  const data = (await readDocument(page)).data, bus = data.boards[0].wiring!.buses[0], main = data.devices.find((item) => item.code === 'Q1')!;
  const from = { kind:'device', deviceId:main.id, side:'top', pole:0 }, terminal = (n:number) => ({ kind:'bus', busId:bus.id, terminal:n });
  for (const to of [terminal(0), terminal(1)]) {
    await page.getByLabel('Vezeték kezdőpontja', { exact:true }).selectOption(JSON.stringify(from));
    await page.getByLabel('Vezeték végpontja', { exact:true }).selectOption(JSON.stringify(to));
    await page.getByRole('button', { name:'Vezeték létrehozása', exact:true }).click();
  }
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.wires.length).toBe(2);
  const first = (await readDocument(page)).data.boards[0].wiring!.wires[0];
  await page.locator('.wiring-wire-list button').first().click();
  await page.getByRole('button', { name:'Töréspont hozzáadása', exact:true }).click();
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.wires[0].points?.length).toBeGreaterThan(0);
  const savedPoints = (await readDocument(page)).data.boards[0].wiring!.wires[0].points;
  const handle = page.getByTestId('wire-endpoint-to');
  const busPoint = (n:number) => page.getByRole('button', { name:`Új sín · ${n} (N)`, exact:true }).locator('.wiring-terminal-hit');
  await drag(page, handle, busPoint(2));
  await expect(page.getByRole('alert')).toContainText('Ez a vezeték már szerepel');
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].to).toEqual(first.to);
  await drag(page, handle, busPoint(3));
  await expect.poll(async () => (await readDocument(page)).data.boards[0].wiring!.wires[0].to).toEqual(terminal(2));
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].points).toEqual(savedPoints);
  const rendered = await page.locator('.wiring-wire.selected .wiring-wire-hit').getAttribute('points');
  const vertices = rendered!.split(' ').map((value) => value.split(',').map(Number));
  expect(vertices.every((point, index) => !index || point[0] === vertices[index - 1][0] || point[1] === vertices[index - 1][1])).toBe(true);
  await page.getByLabel('Kijelölt vezeték végpontja', { exact:true }).selectOption(JSON.stringify(terminal(1)));
  await expect(page.getByRole('alert')).toContainText('Ez a vezeték már szerepel');
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].to).toEqual(terminal(2));
  await drag(page, handle, page.locator('.wiring-row').first());
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].to).toEqual(terminal(2));
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].to).toEqual(terminal(2));
});
