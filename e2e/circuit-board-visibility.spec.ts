import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function saved(page:Page):Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    return new Promise<ProjectDocument>((resolve,reject) => {
      const open = indexedDB.open('villamos-tervezo-local');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, request = db.transaction('projects','readonly').objectStore('projects').get(id);
        request.onerror = () => {db.close(); reject(request.error);};
        request.onsuccess = () => {const document = request.result.document; db.close(); resolve(document);};
      };
    });
  });
}
const view = (page:Page,name:string) => page.locator('.view-tabs').getByRole('button',{name,exact:true});
const circuitSwitch = (page:Page,code:string) => page.getByRole('switch',{name:`${code}: Megjelenítés az elosztó felületén`,exact:true});

test('hides and restores the circuit drawing while preserving its connection and saved routing',async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), circuit = initial.data.circuits[0], board = initial.data.boards[0];
  await view(page,'Elosztó').click();
  const drawing = page.locator('.wiring-diagram');
  const box = drawing.locator(`[data-circuit-id="${circuit.id}"]`);
  await box.getByRole('button',{name:/^L · ÁK1.*áramköri végpont/}).click();
  await drawing.getByRole('button',{name:'QF1 · alsó 1 (L)',exact:true}).click();
  const terminal = async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.boardConnections?.find(item => item.boardId === board.id)?.terminals.find(item => item.conductor === 'L');
  await expect.poll(terminal).toBeTruthy();
  const wire = drawing.locator(`[data-circuit-link="${circuit.id}"][data-conductor="L"]`);
  await wire.locator('.wiring-wire-hit').focus(); await wire.locator('.wiring-wire-hit').press('Enter');
  await page.getByRole('button',{name:'Töréspont hozzáadása',exact:true}).click();
  await expect.poll(async () => (await terminal())?.points?.length).toBeGreaterThan(0);
  const original = await terminal();
  await view(page,'Áramkörök').click();
  await expect(circuitSwitch(page,circuit.code)).toBeChecked();
  await circuitSwitch(page,circuit.code).uncheck();
  await expect.poll(async () => (await saved(page)).data.circuits.find(item => item.id === circuit.id)?.hideOnBoards).toBe(true);
  expect(await terminal()).toEqual(original);
  await view(page,'Elosztó').click();
  await expect(box).toHaveCount(0); await expect(wire).toHaveCount(0);
  await page.reload(); await reopenRecentProject(page); await view(page,'Áramkörök').click();
  await expect(circuitSwitch(page,circuit.code)).not.toBeChecked();
  await circuitSwitch(page,circuit.code).check();
  await view(page,'Elosztó').click();
  await expect(box).toBeVisible(); await expect(wire).toBeVisible();
  expect(await terminal()).toEqual(original);
});

test('new circuits are shown by default and keep their original board when hidden and a second board is added',async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const initial = await saved(page), boardId = initial.data.boards[0].id;
  await view(page,'Áramkörök').click();
  await page.getByRole('button',{name:'Új áramkör',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.circuits.length).toBe(initial.data.circuits.length + 1);
  const added = (await saved(page)).data.circuits.find(item => !initial.data.circuits.some(old => old.id === item.id))!;
  await expect(circuitSwitch(page,added.code)).toBeChecked();
  await circuitSwitch(page,added.code).uncheck();
  await view(page,'Elosztó').click();
  await expect(page.locator(`.wiring-circuit[data-circuit-id="${added.id}"]`)).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept('Második elosztó'));
  await page.getByRole('button',{name:'Új elosztó',exact:true}).click();
  await expect.poll(async () => (await saved(page)).data.boards.length).toBe(2);
  await view(page,'Áramkörök').click();
  await expect(circuitSwitch(page,added.code)).not.toBeChecked();
  await circuitSwitch(page,added.code).check();
  await view(page,'Elosztó').click();
  await expect(page.locator(`.wiring-circuit[data-circuit-id="${added.id}"]`)).toHaveCount(0);
  await page.getByLabel('Aktív elosztó',{exact:true}).selectOption(boardId);
  await expect(page.locator(`.wiring-circuit[data-circuit-id="${added.id}"]`)).toBeVisible();
});

test('the board menu can restore a globally hidden circuit without contradicting the circuit switch',async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const circuit = (await saved(page)).data.circuits[0];
  await view(page,'Áramkörök').click();
  await circuitSwitch(page,circuit.code).uncheck();
  await view(page,'Elosztó').click();
  await page.locator('.board-circuit-menu summary').click();
  const boardChoice = page.locator('.board-circuit-menu-content label').filter({hasText:circuit.code}).getByRole('checkbox');
  await expect(boardChoice).not.toBeChecked();
  await boardChoice.check();
  await expect(page.locator(`.wiring-circuit[data-circuit-id="${circuit.id}"]`)).toBeVisible();
  await view(page,'Áramkörök').click();
  await expect(circuitSwitch(page,circuit.code)).toBeChecked();
});

test('explains and preserves a board-specific hidden state when the global switch is on',async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  const {data} = await saved(page), circuit = data.circuits[0], board = data.boards[0];
  await view(page,'Elosztó').click();
  await page.locator('.board-circuit-menu summary').click();
  const boardChoice = page.locator('.board-circuit-menu-content label').filter({hasText:circuit.code}).getByRole('checkbox');
  await boardChoice.uncheck();
  await view(page,'Áramkörök').click();
  const card = page.locator(`.circuit-card[data-circuit-id="${circuit.id}"]`);
  await expect(circuitSwitch(page,circuit.code)).toBeChecked();
  await expect(card).toContainText(`Ezeken az elosztókon külön rejtett: ${board.name}`);
  await circuitSwitch(page,circuit.code).uncheck();
  await circuitSwitch(page,circuit.code).check();
  await expect(card).toContainText(`Ezeken az elosztókon külön rejtett: ${board.name}`);
  await view(page,'Elosztó').click();
  await expect(page.locator(`.wiring-circuit[data-circuit-id="${circuit.id}"]`)).toHaveCount(0);
  await page.locator('.board-circuit-menu summary').click();
  await boardChoice.check();
  await view(page,'Áramkörök').click();
  await expect(card).not.toContainText('Ezeken az elosztókon külön rejtett:');
});
