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
        const db = open.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const doc = get.result.document; db.close(); resolve(doc); };
      };
    });
  });
}
async function clickAtOrigin(page: Page, selector: string) {
  const position = await page.locator(selector).first().evaluate(element => {
    const matrix = (element as SVGGElement).getScreenCTM()!;
    const point = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x:point.x, y:point.y };
  });
  await page.mouse.click(position.x, position.y);
}

test('assigns a floor route to a circuit and board terminals without changing the connected device', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.getByRole('button', { name:'Elosztó elhelyezése', exact:true }).click();
  await page.locator('.floor-svg').click({ position:{x:420,y:300} });
  await page.getByRole('button', { name:'Kapcsolat / nyomvonal', exact:true }).click();
  await clickAtOrigin(page, '.floor-board-marker');
  await clickAtOrigin(page, '.floor-device');
  const first = await documentData(page);
  const boardId = first.data.sheets[0].boardPlacements![0].boardId;
  const deviceId = first.data.sheets[0].placements[0].deviceId;
  const originalCircuit = first.data.devices.find(device => device.id === deviceId)!.circuitId;
  const secondCircuit = first.data.circuits[1];
  const routeId = first.data.sheets[0].routes.find(route => route.fromBoardId === boardId && route.toDeviceId === deviceId)!.id;
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  const card = page.getByTestId('floor-board-route-card');
  await expect(card).toHaveCount(1);
  await expect(page.locator(`.wiring-floor-route[data-floor-route-id="${routeId}"]`)).toBeVisible();
  await expect(card).toContainText(first.data.sheets[0].name);
  await card.getByLabel(/nyomvonal áramköre/).selectOption(secondCircuit.id);
  await expect(card.getByRole('alert')).toContainText('eltér');
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(route => route.id === routeId)?.explicitCircuitId).toBe(secondCircuit.id);
  expect((await documentData(page)).data.devices.find(device => device.id === deviceId)?.circuitId).toBe(originalCircuit);

  const conductor = card.getByLabel(/^Új vezető:/);
  const terminal = card.getByLabel(/^Új vezető kapcsa:/);
  await page.getByRole('button', { name:'Betáplálás hozzáadása', exact:true }).click();
  await expect(conductor.locator('option')).toHaveText(['L','N','PE','PEN']);
  await conductor.selectOption('L');
  const l = await terminal.locator('option').nth(1).getAttribute('value');
  expect(l).toBeTruthy();
  await terminal.selectOption(l!);
  await card.getByRole('button', { name:'Vezető hozzárendelése' }).click();
  await expect(card.getByLabel(/^L kapcsa:/)).toHaveValue(l!);
  await expect(page.locator('[data-floor-route-link][data-conductor="L"]')).toBeVisible();
  await conductor.selectOption('N');
  const n = await terminal.locator('option').nth(1).getAttribute('value');
  expect(n).toBeTruthy();
  await terminal.selectOption(n!);
  await card.getByRole('button', { name:'Vezető hozzárendelése' }).click();
  await expect(card.getByLabel(/^N kapcsa:/)).toHaveValue(n!);
  await expect(page.locator('[data-floor-route-link][data-conductor="N"]')).toBeVisible();
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(route => route.id === routeId)?.boardTerminals?.length).toBe(2);

  const nEndpoint = JSON.parse(n!);
  expect(nEndpoint.kind).toBe('device');
  expect(nEndpoint.pole).toBeGreaterThan(0);
  const sourceDevice = page.locator(`.wiring-device-group[data-device-id="${nEndpoint.deviceId}"] rect[role="button"]`);
  await sourceDevice.focus();
  await sourceDevice.press('Enter');
  await page.locator('.electrical-device-fields>summary').click();
  const poleCount = page.getByLabel('Pólusok: Pólusok száma');
  const originalCount = await poleCount.inputValue();
  await poleCount.fill('1');
  await expect(page.locator('.electrical-device-fields [role="alert"]')).toBeVisible();
  await expect(poleCount).toHaveValue(originalCount);

  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await expect(card.getByLabel(/nyomvonal áramköre/)).toHaveValue(secondCircuit.id);
  await expect(card.getByLabel(/^L kapcsa:/)).toHaveValue(l!);
  await expect(card.getByLabel(/^N kapcsa:/)).toHaveValue(n!);
  await card.getByRole('button', { name:'L kapocs-hozzárendelés törlése' }).click();
  await expect(card.getByLabel(/^L kapcsa:/)).toHaveCount(0);
  await expect(page.locator('[data-floor-route-link][data-conductor="L"]')).toHaveCount(0);
  await expect(card.getByLabel(/^N kapcsa:/)).toHaveValue(n!);
  await expect.poll(async () => (await documentData(page)).data.sheets[0].routes.find(route => route.id === routeId)?.boardTerminals?.length).toBe(1);
});
