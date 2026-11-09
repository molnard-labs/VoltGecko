import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample } from './startup';

async function documentData(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { const value = get.result.document; db.close(); resolve(value); };
      };
    });
  });
}

test('shows the bottom add-bend button only for the selected wire and stores the new point', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await chooseSample(page);
  const document = await documentData(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  const button = page.getByRole('button', { name: 'Töréspont hozzáadása', exact: true });
  await expect(button).toHaveCount(0);
  const main = document.data.devices.find(device => device.code === 'Q1')!;
  const other = document.data.devices.find(device => device.code === 'QF1')!;
  const endpoint = (deviceId: string) => JSON.stringify({ kind: 'device', deviceId, side: 'top', pole: 0 });
  await page.getByLabel('Vezeték kezdőpontja', { exact: true }).selectOption(endpoint(main.id));
  await page.getByLabel('Vezeték végpontja', { exact: true }).selectOption(endpoint(other.id));
  await page.getByRole('button', { name: 'Vezeték létrehozása', exact: true }).click();
  await expect(button).toBeVisible();
  const size = await button.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
  const before = await page.locator('[data-testid^="wire-bend-"]').count();
  await button.click();
  await expect(page.locator('[data-testid^="wire-bend-"]')).toHaveCount(before + 1);
  await expect.poll(async () => (await documentData(page)).data.boards[0].wiring?.wires[0]?.points?.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Rácshoz illesztés' }).click();
  const coordinate = page.getByLabel('1. töréspont x');
  const initial = Number(await coordinate.inputValue());
  await coordinate.fill(String(initial + 13));
  const route = await page.locator('.wiring-wire.selected .wiring-wire-hit').getAttribute('points');
  const points = route!.split(' ').map(point => point.split(',').map(Number));
  for (let i = 1; i < points.length; i++)
    expect(points[i][0] === points[i - 1][0] || points[i][1] === points[i - 1][1]).toBe(true);
  await page.locator('rect.wiring-device').first().click();
  await expect(button).toHaveCount(0);
});
