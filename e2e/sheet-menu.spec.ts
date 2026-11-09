import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('renames and confirms deletion of a drawing sheet', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  page.once('dialog', dialog => dialog.accept('Konyha'));
  await page.getByRole('button', { name: 'Üres tervlap hozzáadása' }).click();
  const sheets = page.getByLabel('Aktív tervlap', { exact: true });
  await expect(sheets.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Tervlap műveletei' }).click();
  page.once('dialog', dialog => dialog.accept('Új konyha'));
  await page.getByRole('button', { name: 'Átnevezés', exact: true }).click();
  await expect(sheets.locator('option:checked')).toHaveText('Új konyha');
  await page.getByRole('button', { name: 'Tervlap műveletei' }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Törlés', exact: true }).click();
  await expect(sheets.locator('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Tervlap műveletei' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Törlés', exact: true }).click();
  await expect(sheets.locator('option')).toHaveCount(1);
});
