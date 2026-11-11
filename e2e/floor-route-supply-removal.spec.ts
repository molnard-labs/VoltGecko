import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('confirms removal of circuit assignments when shrinking or deleting a supply', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  await page.getByRole('button', { name:'Betáplálás hozzáadása', exact:true }).click();
  const diagram = page.locator('.wiring-diagram');
  const circuit = diagram.locator('.wiring-circuit').first();
  const id = await circuit.getAttribute('data-circuit-id');
  const link = (conductor: string) => diagram.locator(`[data-circuit-link="${id}"][data-conductor="${conductor}"]`);
  await circuit.getByRole('button', {name:/^PE · .*áramköri végpont/}).click();
  await diagram.getByRole('button', {name:'Külső betáplálás · 3 (PE)',exact:true}).click();
  await expect(link('PE')).toBeVisible();
  const source = page.locator('.wiring-item').filter({ hasText:'Külső betáplálás' }).last();
  await source.locator('summary').click();
  const poles = source.getByLabel('1. betáplálás pólusai: Pólusok száma');
  page.once('dialog', dialog => dialog.dismiss());
  await poles.fill('2');
  await expect(poles).toHaveValue('3');
  await expect(link('PE')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await poles.fill('2');
  await expect(poles).toHaveValue('2');
  await expect(link('PE')).toHaveCount(0);

  await circuit.getByRole('button', {name:/^N · .*áramköri végpont/}).click();
  await diagram.getByRole('button', {name:'Külső betáplálás · 2 (N)',exact:true}).click();
  await expect(link('N')).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await source.getByRole('button', { name:'Betáplálás törlése' }).click();
  await expect(source).toBeVisible();
  await expect(link('N')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await source.getByRole('button', { name:'Betáplálás törlése' }).click();
  await expect(source).toHaveCount(0);
  await expect(link('N')).toHaveCount(0);
});
