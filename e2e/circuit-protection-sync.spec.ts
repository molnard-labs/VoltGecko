import { expect, test, type Page } from '@playwright/test';
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

test('shows actual cabinet phase connection read-only instead of old manual protection', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), circuit = initial.data.circuits[0], board = initial.data.boards[0];
  const qf1 = initial.data.devices.find(device => device.code === 'QF1')!;
  const qf2 = initial.data.devices.find(device => device.code === 'QF2')!;
  expect(circuit.protectionDeviceId).toBe(qf1.id);
  const tab = (name:string) => page.locator('.view-tabs').getByRole('button',{name,exact:true}).click();
  const value = page.getByLabel('ÁK1 védelme',{exact:true});
  await tab('Áramkörök');
  await expect(page.getByRole('combobox',{name:'ÁK1 védelme',exact:true})).toHaveCount(0);
  await expect(value).toContainText('Nincs fázisbekötés az elosztón.');
  const connections = async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals;

  await tab('Elosztó');
  const diagram = page.locator('.wiring-diagram');
  const box = diagram.locator(`[data-circuit-id="${circuit.id}"]`);
  const connector = box.getByRole('button',{name:/^L · ÁK1.*áramköri végpont/});
  await connector.click();
  await diagram.getByRole('button',{name:'QF2 · alsó 1 (L)',exact:true}).click();
  await expect.poll(connections).toMatchObject([{conductor:'L',endpoint:{kind:'device',deviceId:qf2.id}}]);
  await tab('Áramkörök');
  await expect(value).toContainText('QF2');
  await expect(value).not.toContainText('QF1');
  await page.reload(); await reopenRecentProject(page); await tab('Áramkörök');
  await expect(value).toContainText('QF2');

  await tab('Elosztó');
  await connector.click();
  await diagram.getByRole('button',{name:'QF1 · alsó 1 (L)',exact:true}).click();
  await expect.poll(connections).toMatchObject([{conductor:'L',endpoint:{kind:'device',deviceId:qf1.id}}]);
  await tab('Áramkörök');
  await expect(value).toContainText('QF1');
  await expect(value).not.toContainText('QF2');
  await tab('Elosztó');
  const hit = diagram.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"] .wiring-wire-hit`);
  await hit.focus(); await hit.press('Enter');
  await page.getByRole('button',{name:'Kijelölt vezeték törlése',exact:true}).click();
  await expect.poll(connections).toEqual([]);
  await tab('Áramkörök');
  await expect(value).toContainText('Nincs fázisbekötés az elosztón.');
  expect((await saved(page)).data.circuits[0].protectionDeviceId).toBe(qf1.id);
});
