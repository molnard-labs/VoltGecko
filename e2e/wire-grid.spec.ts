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
        const db = open.result, get = db.transaction('projects','readonly').objectStore('projects').get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { const value = get.result.document; db.close(); resolve(value); };
      };
    });
  });
}

test('snap, insert and remove wire bends while keeping exact orthogonal terminals', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const original = await documentData(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const toggle = page.getByRole('button',{name:'Rácshoz illesztés'});
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('wiring-grid')).toBeVisible();
  const main = original.data.devices.find(item => item.code === 'Q1')!;
  const other = original.data.devices.find(item => item.code === 'QF1')!;
  const endpoint = (deviceId: string, side: 'top' | 'bottom') => JSON.stringify({kind:'device',deviceId,side,pole:0});
  await page.getByLabel('Vezeték kezdőpontja',{exact:true}).selectOption(endpoint(main.id,'top'));
  await page.getByLabel('Vezeték végpontja',{exact:true}).selectOption(endpoint(other.id,'top'));
  await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await expect.poll(async () => (await documentData(page)).data.boards[0].wiring?.wires.length).toBe(1);
  const firstWire = (await documentData(page)).data.boards[0].wiring!.wires[0];
  const beforeCount = await page.locator('[data-testid^="wire-bend-"]').count();
  await page.getByRole('button',{name:'Töréspont hozzáadása'}).click();
  await expect(page.locator('[data-testid^="wire-bend-"]')).toHaveCount(beforeCount + 1);
  const bend = page.getByTestId('wire-bend-0'); await bend.scrollIntoViewIfNeeded();
  const box = await bend.boundingBox(); if (!box) throw new Error('Missing bend');
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+31,box.y+box.height/2+23,{steps:5}); await page.mouse.up();
  await expect.poll(async () => (await documentData(page)).data.boards[0].wiring!.wires[0].points).toBeDefined();
  const points = (await documentData(page)).data.boards[0].wiring!.wires[0].points!;
  expect(points.some(point => point.x % 10 === 0 && point.y % 10 === 0)).toBe(true);
  const route = await page.locator('.wiring-wire.selected .wiring-wire-hit').getAttribute('points');
  const path = route!.split(' ').map(value=>value.split(',').map(Number));
  for (let i=1; i<path.length; i++) expect(path[i][0] === path[i-1][0] || path[i][1] === path[i-1][1]).toBe(true);
  const remove = page.getByRole('button',{name:'1. töréspont törlése'});
  await remove.click();
  await expect.poll(async () => (await documentData(page)).data.boards[0].wiring!.wires[0].points).not.toEqual(points);
  const after = (await documentData(page)).data.boards[0].wiring!.wires[0];
  expect(after.from).toEqual(firstWire.from); expect(after.to).toEqual(firstWire.to);
  await toggle.click(); await expect(toggle).toHaveAttribute('aria-pressed','false'); await expect(page.getByTestId('wiring-grid')).toHaveCount(0);
  await page.reload(); await reopenRecentProject(page); await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  expect((await documentData(page)).data.boards[0].wiring!.wires[0].points).toEqual(after.points);
});
