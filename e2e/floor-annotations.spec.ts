import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

test('persists floor opacity and styled movable text, and hides the note hint for other tools', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.getByRole('button', { name: 'Rétegek', exact: true }).click();
  await page.getByLabel('Alaprajz fedettsége', { exact: true }).fill('35');
  await expect(page.locator('.floor-svg > image').first()).toHaveAttribute('opacity', '0.35');
  await page.getByRole('button', { name: 'Rétegek', exact: true }).click();
  await page.getByRole('button', { name: 'Szöveg a rajzon' }).click();
  page.once('dialog', dialog => dialog.accept('Konyha'));
  await page.locator('.floor-svg').click({ position: { x: 250, y: 220 } });
  await page.getByLabel('Szöveg', { exact: true }).fill('Konyha\nFelirat');
  await page.getByRole('spinbutton', { name: 'Betűméret' }).fill('24');
  await page.getByLabel('Szín', { exact: true }).fill('#123456');
  await expect(page.locator('.floor-note').filter({ hasText: 'Konyha' }).locator('text')).toHaveAttribute('fill', '#123456');
  await expect(page.locator('.floor-note').filter({ hasText: 'Konyha' }).locator('text')).toHaveAttribute('font-size', '24');
  await page.reload();
  await reopenRecentProject(page);
  await expect(page.locator('.floor-svg > image').first()).toHaveAttribute('opacity', '0.35');
  await expect(page.locator('.floor-note').filter({ hasText: 'Konyha' }).locator('text')).toBeVisible();
  await page.getByRole('button', { name: 'Megjegyzés a rajzon' }).click();
  await page.locator('.floor-note').filter({ hasText: 'MINTATERV' }).click();
  await expect(page.getByText('Megjegyzés · dupla kattintás: szerkesztés')).toBeVisible();
  await page.getByRole('button', { name: 'Kijelölés és mozgatás' }).click();
  await expect(page.getByText('Megjegyzés · dupla kattintás: szerkesztés')).toHaveCount(0);
});
