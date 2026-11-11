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
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { const doc = get.result.document; db.close(); resolve(doc); };
      };
    });
  });
}

test('manages circuit visibility and its terminal assignments independently for a board', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await documentData(page), circuitId = initial.data.circuits[0].id, boardId = initial.data.boards[0].id;
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram'), box = diagram.locator(`[data-circuit-id="${circuitId}"]`);
  await expect(box).toBeVisible();
  await page.getByText('Áramkörök az elosztón',{exact:true}).click();
  const option = page.getByLabel('ÁK1 · Nappali dugaljak',{exact:true});
  await expect(option).toBeChecked(); await option.uncheck(); await expect(box).toHaveCount(0);
  await option.check(); await expect(box).toBeVisible();
  await page.getByText('Áramkörök az elosztón',{exact:true}).click();
  await page.getByRole('button',{name:'Betáplálás hozzáadása',exact:true}).click();
  const item = page.getByTestId('board-circuit-item').filter({hasText:'ÁK1'});
  await item.locator('summary').click();
  const conductor = item.getByLabel('ÁK1: új vezető',{exact:true});
  const terminal = item.getByLabel('ÁK1: új vezető kapcsa',{exact:true});
  await expect(conductor.locator('option')).toHaveText(['L','N','PE','PEN']);
  await conductor.selectOption('L');
  const l = await terminal.locator('option').filter({hasText:'Külső betáplálás'}).first().getAttribute('value');
  await terminal.selectOption(l!); await item.getByRole('button',{name:'Vezető hozzárendelése'}).click();
  await expect(item.getByLabel('ÁK1: L kapcsa',{exact:true})).toHaveValue(l!);
  await conductor.selectOption('N');
  const n = await terminal.locator('option').filter({hasText:'Külső betáplálás'}).first().getAttribute('value');
  await terminal.selectOption(n!); await item.getByRole('button',{name:'Vezető hozzárendelése'}).click();
  await expect(item.getByLabel('ÁK1: N kapcsa',{exact:true})).toHaveValue(n!);
  await expect.poll(async () => (await documentData(page)).data.circuits.find(item=>item.id===circuitId)?.boardConnections?.find(item=>item.boardId===boardId)?.terminals.length).toBe(2);
  await page.reload(); await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  await item.locator('summary').click();
  await expect(item.getByLabel('ÁK1: L kapcsa',{exact:true})).toHaveValue(l!);
  await expect(item.getByLabel('ÁK1: N kapcsa',{exact:true})).toHaveValue(n!);
  await item.getByRole('button',{name:'ÁK1: L hozzárendelés törlése',exact:true}).click();
  await expect(item.getByLabel('ÁK1: L kapcsa',{exact:true})).toHaveCount(0);
  await expect(item.getByLabel('ÁK1: N kapcsa',{exact:true})).toHaveValue(n!);
});
