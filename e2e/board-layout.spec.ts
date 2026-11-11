import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('keeps board controls above the drawing and moves presets to the sidebar', async ({page}) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', {name:'Elosztó',exact:true}).click();
  const diagram = page.locator('.wiring-diagram-container');
  const rows = page.locator('.board-row-controls');
  await expect(diagram).toBeVisible();
  expect((await diagram.boundingBox())!.y).toBeLessThan((await rows.boundingBox())!.y);
  const toolbar = page.locator('.workspace-toolbar');
  await expect(toolbar.getByLabel('Aktív elosztó',{exact:true})).toBeVisible();
  await expect(toolbar.getByRole('button',{name:'Új elosztó',exact:true})).toBeVisible();
  await expect(toolbar.getByRole('button',{name:'Elosztó törlése',exact:true})).toBeVisible();
  const grid = toolbar.getByRole('button', {name:'Rácshoz illesztés',exact:true});
  await expect(grid).toHaveAttribute('title','Rácshoz illesztés');
  await expect(grid).toHaveText('');
  await expect(grid).toHaveAttribute('aria-pressed','true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed','false');
  await expect(page.getByRole('button',{name:'Sorkapocs hozzáadása',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Motorvédő hozzáadása',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Fogyasztásmérő hozzáadása',exact:true})).toHaveCount(0);
  await expect(page.locator('.board-catalog').getByRole('button',{name:/^Sorkapocs/})).toBeVisible();
  await expect(page.locator('.board-catalog').getByRole('button',{name:/^Motorvédő/})).toBeVisible();
  await expect(page.locator('.board-catalog').getByRole('button',{name:/^Fogyasztásmérő/})).toBeVisible();
});

test('keeps board grid control in the top menu on a small screen', async ({page}) => {
  await page.setViewportSize({width:320,height:680});
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const grid = page.locator('.workspace-toolbar').getByRole('button',{name:'Rácshoz illesztés',exact:true});
  await expect(grid).toBeVisible();
  await page.locator('.editor-area').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('.workspace').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(grid).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('edits and removes circuit-terminal assignments below the drawing', async ({page}) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const section=page.getByRole('region',{name:'Áramkörök kapcsai'});
  const card=section.getByTestId('board-circuit-item').filter({hasText:'ÁK1'});
  await card.locator('summary').click();
  const conductor=card.getByLabel('ÁK1: új vezető',{exact:true});
  await conductor.selectOption('L');
  const endpoint=card.getByLabel('ÁK1: új vezető kapcsa',{exact:true});
  const option=endpoint.locator('option').filter({hasText:'QF1 · alsó 1 (L)'});
  const value=await option.getAttribute('value');
  expect(value).toBeTruthy();
  await endpoint.selectOption(value!);
  await card.getByRole('button',{name:'Vezető hozzárendelése',exact:true}).click();
  await expect(card.getByLabel('ÁK1: L kapcsa',{exact:true})).toHaveValue(value!);
  await card.getByRole('button',{name:'ÁK1: L hozzárendelés törlése',exact:true}).click();
  await expect(card.getByLabel('ÁK1: L kapcsa',{exact:true})).toHaveCount(0);
});

test('confirms before removing a supply pole assigned to a circuit', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  await page.getByRole('button',{name:'Betáplálás hozzáadása',exact:true}).click();
  const card=page.getByTestId('board-circuit-item').filter({hasText:'ÁK1'});
  await card.locator('summary').click();
  await card.getByLabel('ÁK1: új vezető',{exact:true}).selectOption('PE');
  const terminal=card.getByLabel('ÁK1: új vezető kapcsa',{exact:true});
  const value=await terminal.locator('option').filter({hasText:'Külső betáplálás'}).first().getAttribute('value');
  expect(value).toBeTruthy(); await terminal.selectOption(value!);
  await card.getByRole('button',{name:'Vezető hozzárendelése',exact:true}).click();
  const item=page.locator('.wiring-item').filter({hasText:'Külső betáplálás'}).last();
  await item.locator('summary').click();
  const count=item.getByLabel('1. betáplálás pólusai: Pólusok száma',{exact:true});
  page.once('dialog',dialog=>dialog.dismiss()); await count.fill('2');
  await expect(count).toHaveValue('3');
  await expect(card.getByLabel('ÁK1: PE kapcsa',{exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept()); await count.fill('2');
  await expect(count).toHaveValue('2');
  await expect(card.getByLabel('ÁK1: PE kapcsa',{exact:true})).toHaveCount(0);
});

test('prevents reducing device poles below a circuit assignment', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const card=page.getByTestId('board-circuit-item').filter({hasText:'ÁK1'});
  await card.locator('summary').click();
  await card.getByLabel('ÁK1: új vezető',{exact:true}).selectOption('N');
  const terminal=card.getByLabel('ÁK1: új vezető kapcsa',{exact:true});
  const value=await terminal.locator('option').filter({hasText:'Q1 · alsó 2 (N)'}).getAttribute('value');
  expect(value).toBeTruthy(); await terminal.selectOption(value!);
  await card.getByRole('button',{name:'Vezető hozzárendelése',exact:true}).click();
  await page.locator('.wiring-device-group').filter({hasText:'Q1'}).first().click();
  await page.locator('.electrical-device-fields>summary').click();
  const count=page.getByLabel('Pólusok: Pólusok száma',{exact:true});
  await count.fill('1');
  await expect(page.getByText('A pólusszám nem csökkenthető a bekötött pólusok alá.')).toBeVisible();
  await expect(count).toHaveValue('2');
  await expect(card.getByLabel('ÁK1: N kapcsa',{exact:true})).toHaveValue(value!);
});
