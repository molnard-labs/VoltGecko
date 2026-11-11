import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseSample } from './startup';

test('a failed sidebar download keeps the mobile drawing and workspace controls within view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/src/app/EditorSidebar.tsx*', route => route.abort('internetdisconnected'));
  await page.goto('/');
  await chooseSample(page);
  await expect(page.locator('.floor-device')).toHaveCount(8);
  await expect(page.locator('.sidebar [role="alert"]')).toHaveCount(1);
  const workspace = await page.locator('.workspace').boundingBox();
  expect(workspace?.y).toBe(0);
  const floor = await page.locator('.floor-svg').boundingBox();
  expect(floor!.y).toBeLessThan(844);
  await page.getByRole('button', { name: 'Eszköztár megnyitása', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Újratöltés', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Eszköztár bezárása', exact: true }).click();
  await expect(page.locator('.floor-svg')).toBeVisible();
});

test('a failed optional view leaves the floor plan and project export usable', async ({ page }) => {
  await page.route('**/src/components/BoardEditor.tsx*', route => route.abort('internetdisconnected'));
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  await expect(page.locator('.floor-device')).toHaveCount(8);

  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  const failure = page.getByRole('alert');
  await expect(failure).toContainText('A nézet nem tölthető be. A folytatáshoz töltsd újra az oldalt.');
  await expect(failure.getByRole('button', { name: 'Újratöltés', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('.project-switch strong')).toHaveText('Dunaparti lakás');

  await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.floor-device')).toHaveCount(8);
  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektfájl mentése', exact: false }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.vgecko$/);
  const filename = test.info().outputPath('after-feature-error.vgecko');
  await download.saveAs(filename);
  expect((await readFile(filename)).subarray(0, 2).toString()).toBe('PK');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
});

test('a pending manufacturer library traps focus and hands it to the loaded dialog and back to its opener', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/src/app/ManufacturerLibrary.tsx*', async route => {
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/');
    await chooseSample(page);
    await expect(page.locator('.floor-device')).toHaveCount(8);
    const opener = page.locator('.manufacturer-library-button');
    await opener.click();
    const loading = page.getByRole('dialog', { name: 'Betöltés…', exact: true });
    await expect(loading).toBeVisible();
    const cancel = loading.getByRole('button', { name: 'Mégse', exact: true });
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(cancel).toBeFocused();
    await cancel.click();
    await expect(loading).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    await expect(cancel).toBeFocused();
    release();
    const library = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
    await expect(library).toBeVisible();
    await expect(library.getByRole('searchbox')).toBeFocused();
    await library.getByRole('button', { name: 'Termékkönyvtár bezárása', exact: true }).click();
    await expect(library).toHaveCount(0);
    await expect(opener).toBeFocused();
  } finally {
    release();
  }
});
