import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('keeps the active workspace view visible on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const navigation = page.locator('.view-tabs');
  await navigation.getByRole('button', { name: 'Áramkörök', exact: true }).click();
  await expect(page.locator('.circuit-cards')).toBeVisible();
  await expect(navigation.getByRole('button', { name: 'Előzmények', exact: true })).toBeVisible();
  await expect.poll(() => navigation.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => navigation.evaluate(el => {
    const active = el.querySelector('[aria-current="page"]')?.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    return !!active && active.left >= bounds.left - 1 && active.right <= bounds.right + 1;
  })).toBe(true);
  const header = page.locator('.workspace-header');
  const top = (await header.boundingBox())!.y;
  await page.locator('.editor-area').evaluate(el => { el.scrollTop = el.scrollHeight; });
  expect((await header.boundingBox())!.y).toBe(top);
  await expect(page.getByRole('button', { name: 'Új áramkör', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await navigation.getByRole('button', { name: 'Előzmények', exact: true }).click();
  await expect(navigation.getByRole('button', { name: 'Előzmények', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => navigation.evaluate(el => {
    const active = el.querySelector('[aria-current="page"]')?.getBoundingClientRect();
    const bounds = el.getBoundingClientRect();
    return !!active && active.left >= bounds.left - 1 && active.right <= bounds.right + 1;
  })).toBe(true);
});
