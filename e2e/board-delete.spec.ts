import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

test('confirms deletion, keeps the other board, and permits removing the last board', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  const selector = page.getByLabel('Aktív elosztó', {exact:true});
  const originalName = await selector.locator('option:checked').textContent();
  page.once('dialog', dialog => dialog.accept('Új elosztó teszt'));
  await page.getByRole('button', {name:'Új elosztó', exact:true}).click();
  await expect(selector.locator('option')).toHaveCount(2);
  await selector.selectOption({label:originalName!});
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', {name:'Elosztó törlése', exact:true}).click();
  await expect(selector.locator('option')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name:'Elosztó törlése', exact:true}).click();
  await expect(selector.locator('option')).toHaveCount(1);
  await expect(selector.locator('option:checked')).toHaveText('Új elosztó teszt');
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await expect(selector.locator('option')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name:'Elosztó törlése', exact:true}).click();
  await expect(page.getByRole('heading', {name:'Kezdj egy elosztóval'})).toBeVisible();
  await expect(page.getByRole('button', {name:'Elosztó létrehozása'})).toBeVisible();
});
