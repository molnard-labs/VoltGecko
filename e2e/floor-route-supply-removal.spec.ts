import { expect, test, type Page } from '@playwright/test';
import { chooseSample } from './startup';

async function clickAtOrigin(page: Page, selector: string) {
  const point = await page.locator(selector).first().evaluate(element => {
    const matrix = (element as SVGGElement).getScreenCTM()!;
    const value = new DOMPoint(0, 0).matrixTransform(matrix);
    return { x:value.x, y:value.y };
  });
  await page.mouse.click(point.x, point.y);
}

test('confirms removal of floor-route assignments when shrinking or deleting a supply', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.getByRole('button', { name:'Elosztó elhelyezése', exact:true }).click();
  await page.locator('.floor-svg').click({ position:{x:420,y:300} });
  await page.getByRole('button', { name:'Kapcsolat / nyomvonal', exact:true }).click();
  await clickAtOrigin(page, '.floor-board-marker');
  await clickAtOrigin(page, '.floor-device');
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await page.getByRole('button', { name:'Betáplálás hozzáadása', exact:true }).click();
  const card = page.getByTestId('floor-board-route-card');
  const conductor = card.getByLabel(/^Új vezető:/);
  const terminal = card.getByLabel(/^Új vezető kapcsa:/);
  await conductor.selectOption('PE');
  const peEndpoint = await terminal.locator('option').filter({hasText:'Külső betáplálás'}).first().getAttribute('value');
  await terminal.selectOption(peEndpoint!);
  await card.getByRole('button', { name:'Vezető hozzárendelése' }).click();
  await expect(card.getByLabel(/^PE kapcsa:/)).toBeVisible();
  const source = page.locator('.wiring-item').filter({ hasText:'Külső betáplálás' }).last();
  await source.locator('summary').click();
  const poles = source.getByLabel('1. betáplálás pólusai: Pólusok száma');
  page.once('dialog', dialog => dialog.dismiss());
  await poles.fill('2');
  await expect(poles).toHaveValue('3');
  await expect(card.getByLabel(/^PE kapcsa:/)).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await poles.fill('2');
  await expect(poles).toHaveValue('2');
  await expect(card.getByLabel(/^PE kapcsa:/)).toHaveCount(0);

  await conductor.selectOption('N');
  const nEndpoint = await terminal.locator('option').filter({hasText:'Külső betáplálás'}).first().getAttribute('value');
  await terminal.selectOption(nEndpoint!);
  await card.getByRole('button', { name:'Vezető hozzárendelése' }).click();
  await expect(card.getByLabel(/^N kapcsa:/)).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await source.getByRole('button', { name:'Betáplálás törlése' }).click();
  await expect(source).toBeVisible();
  await expect(card.getByLabel(/^N kapcsa:/)).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await source.getByRole('button', { name:'Betáplálás törlése' }).click();
  await expect(source).toHaveCount(0);
  await expect(card.getByLabel(/^N kapcsa:/)).toHaveCount(0);
});
