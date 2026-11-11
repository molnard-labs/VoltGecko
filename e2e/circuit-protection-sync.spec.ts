import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

test('syncs a breaker assigned from the inspector and preserves a conflicting manual protection', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const tab = (name: string) => page.locator('.view-tabs').getByRole('button', { name, exact:true }).click();
  await tab('Áramkörök');
  await page.getByRole('button', { name:'Új áramkör', exact:true }).click();
  await tab('Elosztó');
  await page.locator('.wiring-device-group').filter({ hasText:'QF1' }).click();
  const circuitSelector = page.getByLabel('Eszköz áramköre', { exact:true });
  await circuitSelector.selectOption((await circuitSelector.locator('option').filter({ hasText:'ÁK4' }).getAttribute('value'))!);
  await tab('Áramkörök');
  const newProtection = page.getByLabel('ÁK4 védelme', { exact:true });
  await expect(newProtection.locator('option:checked')).toContainText('QF1');
  await page.reload();
  await reopenRecentProject(page);
  await tab('Áramkörök');
  await expect(newProtection.locator('option:checked')).toContainText('QF1');

  // The sample already has a manually selected QF1 for ÁK1. Selecting QF2
  // should surface the conflict instead of replacing it without asking.
  await tab('Elosztó');
  await page.locator('.wiring-device-group').filter({ hasText:'QF2' }).click();
  await circuitSelector.selectOption((await circuitSelector.locator('option').filter({ hasText:'ÁK1' }).getAttribute('value'))!);
  await expect(page.getByRole('alert').filter({ hasText:'másik védelmi készülék' })).toBeVisible();
  await tab('Áramkörök');
  await expect(page.getByLabel('ÁK1 védelme', { exact:true }).locator('option:checked')).toContainText('QF1');
  await tab('Elosztó');
  await page.getByRole('button', { name:/Védelmi készülék: QF2/ }).click();
  await tab('Áramkörök');
  await expect(page.getByLabel('ÁK1 védelme', { exact:true }).locator('option:checked')).toContainText('QF2');
});
