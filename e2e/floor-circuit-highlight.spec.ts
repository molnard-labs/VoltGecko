import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('highlights all devices and routes on the selected device circuit and updates after reassignment', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const devices = page.locator('.floor-device');
  const routes = page.locator('.floor-route');
  await expect(devices).toHaveCount(8);
  await expect(page.locator('.floor-device-circuit-highlighted')).toHaveCount(0);
  await devices.first().click();
  await expect(page.locator('.floor-device-circuit-highlighted')).toHaveCount(2);
  await expect(routes.first()).not.toHaveClass(/floor-route-circuit-highlighted/);

  // The sample's second circuit contains the existing switch-to-light route.
  await page.getByLabel('Eszköz áramköre', { exact: true }).selectOption({ label: 'ÁK2 · Világítás' });
  await expect(page.locator('.floor-device-circuit-highlighted')).toHaveCount(5);
  await expect(routes.first()).toHaveClass(/floor-route-circuit-highlighted/);
  await expect(devices.first().locator(':scope > circle[stroke="#d59a28"][stroke-width="4"]')).toHaveCount(1);

  await page.getByLabel('Eszköz áramköre', { exact: true }).selectOption('');
  await expect(page.locator('.floor-device-circuit-highlighted')).toHaveCount(0);
  await expect(routes.first()).not.toHaveClass(/floor-route-circuit-highlighted/);
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  const card = page.locator('.circuit-card').filter({ has: page.getByLabel('ÁK2 azonosítója') });
  await expect(card).toBeVisible();
  await expect(card.locator('.circuit-routes')).toHaveCount(0);
});
