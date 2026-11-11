import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';

async function storedProjects(page: Page): Promise<ProjectDocument[]> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('villamos-tervezo-local');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('projects', 'readonly').objectStore('projects').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result.map(row => row.document)); };
    };
  }));
}

async function createNamedProject(page: Page, name: string) {
  await page.getByRole('button', { name: /^Új projekt / }).click();
  await page.getByLabel('Projekt neve', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Projekt létrehozása', exact: true }).click();
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
  await expect(page.locator('.project-switch strong')).toHaveText(name);
}

test('starts empty and only creates a sample after an explicit choice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mivel szeretnél kezdeni?', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await storedProjects(page)).toEqual([]);
  await page.getByRole('button', { name: /^Mintaprojekt kipróbálása / }).click();
  await expect(page.locator('.floor-device')).toHaveCount(8);
  await expect.poll(async () => (await storedProjects(page)).length).toBe(1);
  const original = (await storedProjects(page))[0];
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mivel szeretnél kezdeni?', exact: true })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await storedProjects(page)).toEqual([original]);
  await page.locator('.start-projects').getByRole('button', { name: new RegExp(original.data.name) }).click();
  await expect(page.locator('.floor-device')).toHaveCount(8);
  expect(await storedProjects(page)).toEqual([original]);
});

test('can apply an application update directly from the welcome screen without creating a project', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mivel szeretnél kezdeni?', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('app-update', { detail: async () => { document.documentElement.dataset.startUpdateRequested = 'true'; } })));
  await expect(page.getByText('Új alkalmazásverzió érhető el.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Frissítés', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-start-update-requested', 'true');
  await expect(page.locator('.start-screen')).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await storedProjects(page)).toEqual([]);
});

test('creates a named blank project and preserves edits when returning to start', async ({ page }) => {
  await page.goto('/');
  await createNamedProject(page, 'Saját helyszíni terv');
  await expect(page.locator('.floor-device')).toHaveCount(0);
  await page.getByRole('button', { name: 'Projektbeállítások', exact: true }).click();
  await page.getByLabel('Helyszín', { exact: true }).fill('Budapest – helyszíni módosítás');
  await page.getByRole('button', { name: 'Kész', exact: true }).click();
  await page.getByRole('button', { name: 'Kezdőképernyő', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mivel szeretnél kezdeni?', exact: true })).toBeVisible();
  await expect(page.locator('.start-projects')).toContainText('Budapest – helyszíni módosítás');
  expect((await storedProjects(page))[0].data.site).toBe('Budapest – helyszíni módosítás');
  await page.reload();
  await page.locator('.start-projects').getByRole('button', { name: /Saját helyszíni terv/ }).click();
  await page.getByRole('button', { name: 'Projektbeállítások', exact: true }).click();
  await expect(page.getByLabel('Helyszín', { exact: true })).toHaveValue('Budapest – helyszíni módosítás');
});

test('imports a project from the welcome screen and reports invalid files there', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await createNamedProject(page, 'Hordozható terv');
  await page.getByRole('button', { name: 'Mentés és export', exact: false }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Projektfájl mentése', exact: false }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.vgecko$/);
  const file = test.info().outputPath('portable.vgecko');
  await download.saveAs(file);
  await page.getByRole('button', { name: 'Kezdőképernyő', exact: true }).click();
  await page.getByRole('button', { name: /^Projekt megnyitása / }).click();
  await expect(page.locator('input[accept*=".vgecko"]')).toHaveAttribute('accept', '.vgecko');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Projektfájl kiválasztása', exact: true }).click();
  await (await chooserPromise).setFiles({ name: 'broken.vgecko', mimeType: 'application/zip', buffer: Buffer.from('invalid project') });
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.start-screen')).toBeVisible();
  const nextChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Projektfájl kiválasztása', exact: true }).click();
  await (await nextChooser).setFiles(file);
  await expect(page.locator('.project-switch strong')).toContainText('Hordozható terv');
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
  expect((await storedProjects(page)).length).toBeGreaterThanOrEqual(1);
});

test('welcome supports English, mobile size, appearance and Drive without an active project', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('Nyelv / Language', { exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'How would you like to start?', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Try sample project / })).toBeVisible();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByLabel('Text size', { exact: true }).selectOption('large');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: /^Open project / }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Google Drive', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save project file', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await storedProjects(page)).toEqual([]);
});
