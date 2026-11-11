import { chooseSample, reopenRecentProject } from './startup';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectDocument } from '../src/types';

const qaDir = path.resolve('tmp/qa');
const languageControl = (page: Page) => page.getByLabel('Nyelv / Language', { exact: true });

async function readDocument(page: Page): Promise<ProjectDocument> {
  return page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject');
    if (!id) throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects', 'readonly').objectStore('projects').get(id);
        get.onerror = () => { db.close(); reject(get.error); };
        get.onsuccess = () => { db.close(); if (!get.result?.document) reject(new Error('Missing active project')); else resolve(get.result.document); };
      };
    });
  });
}

async function openPlanner(page: Page, url = '/') {
  await page.goto(url);
  await chooseSample(page);
  await expect(languageControl(page)).toHaveValue('hu');
  await expect(page.getByText('Ezen az eszközön mentve', { exact: true })).toBeVisible();
  await expect(page.locator('.floor-device')).toHaveCount(8);
}

test.beforeAll(async () => { await mkdir(qaDir, { recursive: true }); });

test('switches all existing workspace views and details between Hungarian and English without changing project data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page);
  const initial = await readDocument(page);
  const firstDevice = initial.data.devices.find(device => device.id === initial.data.sheets[0].placements[0].deviceId)!;

  await languageControl(page).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('VoltGecko');
  await expect(page.locator('.brand')).toContainText('VoltGecko');
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Socket outlet', exact: true })).toHaveAttribute('title', 'Socket outlet with protective earth');
  await expect(page.getByLabel('Search devices', { exact: true })).toHaveAttribute('placeholder', 'Search project devices');
  await page.locator('.floor-device').first().click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue(firstDevice.name);
  await expect(page.getByLabel('Room', { exact: true })).toHaveAttribute('placeholder', 'E.g. living room');
  await expect(page.getByLabel('Device status', { exact: true }).locator('option')).toHaveText(['Planned', 'Installed', 'Verified']);
  await expect(page.getByText('Site photos', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close selection', exact: true }).click();

  await page.locator('.view-tabs').getByRole('button', { name: 'Distribution board', exact: true }).click();
  await expect(page.getByText('DISTRIBUTION BOARD DESIGNER', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Row 1 capacity', { exact: true })).toBeVisible();
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Circuit breaker', exact: false })).toBeVisible();
  await expect(page.locator('.catalog-grid').getByRole('button', { name: /^RCD/ })).toBeVisible();
  await expect(page.locator('.catalog-grid').getByRole('button', { name: /^RCBO/ })).toBeVisible();

  await page.locator('.view-tabs').getByRole('button', { name: 'Circuits', exact: true }).click();
  await expect(page.locator('.view-tabs').getByRole('button', { name: 'Circuits', exact: true })).toHaveClass(/active/);
  await expect(page.getByLabel(`${initial.data.circuits[0].code} name`, { exact: true })).toBeVisible();
  await expect(page.locator('.circuit-cards article').first()).toContainText('Protective device');
  await page.locator('.view-tabs').getByRole('button', { name: /^History/ }).click();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await expect(page.getByLabel('Version notes', { exact: true })).toHaveAttribute('placeholder', 'What changed? E.g. kitchen socket positions updated');

  await page.getByRole('button', { name: 'Guide and privacy', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Guide and privacy', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A clear plan makes site work easier.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Installation and updates', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Project settings', exact: true }).click();
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue(initial.data.name);
  await expect(page.getByLabel('Client', { exact: true })).toHaveValue(initial.data.client);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.project-switch').click();
  await expect(page.getByRole('heading', { name: 'Your projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Floor plan', exact: true }).click();
  await page.screenshot({ path: path.join(qaDir, 'language-desktop-en.png'), fullPage: true });

  await languageControl(page).selectOption('hu');
  await expect(page.locator('html')).toHaveAttribute('lang', 'hu');
  await expect(page).toHaveTitle('VoltGecko');
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Dugalj', exact: true })).toBeVisible();
  expect(await readDocument(page)).toEqual(initial);
  expect(errors).toEqual([]);
});

test('creates English device defaults, preserves existing names and remembers the language after reload', async ({ page }) => {
  await openPlanner(page);
  const initial = await readDocument(page);
  await languageControl(page).selectOption('en');
  await page.locator('.catalog-grid').getByRole('button', { name: 'Socket outlet', exact: true }).click();
  const point = await page.locator('.floor-svg').evaluate(element => {
    const matrix = (element as SVGSVGElement).getScreenCTM();
    if (!matrix) throw new Error('SVG is not rendered');
    const position = new DOMPoint(350, 350).matrixTransform(matrix);
    return { x: position.x, y: position.y };
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('Socket outlet');
  await expect(page.getByLabel('Device identifier', { exact: true })).toHaveValue('D4');
  await expect.poll(async () => (await readDocument(page)).data.devices.length).toBe(initial.data.devices.length + 1);
  const withNewDevice = await readDocument(page);
  for (const device of initial.data.devices) expect(withNewDevice.data.devices.find(current => current.id === device.id)).toEqual(device);
  expect(withNewDevice.revisions).toEqual(initial.revisions);
  await languageControl(page).selectOption('hu');
  await expect(page.getByLabel('Eszköz neve', { exact: true })).toHaveValue('Socket outlet');
  expect(await readDocument(page)).toEqual(withNewDevice);
  await languageControl(page).selectOption('en');
  await page.reload();
  await reopenRecentProject(page);
  await expect(languageControl(page)).toHaveValue('en');
  await expect(page).toHaveTitle('VoltGecko');
  await expect(page.locator('.floor-device')).toHaveCount(9);
  expect(await readDocument(page)).toEqual(withNewDevice);
});

test('keeps the language selector and English interface usable at a 390px phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPlanner(page);
  await page.getByRole('button', { name: 'Eszköztár megnyitása', exact: true }).click();
  await expect(languageControl(page)).toBeVisible();
  await languageControl(page).selectOption('en');
  await expect.poll(async () => (await languageControl(page).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
  const bounds = await languageControl(page).boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Socket outlet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guide and privacy', exact: true })).toBeVisible();
  await page.locator('.sidebar').getByRole('button', { name: 'Close device library', exact: true }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Distribution board', exact: true }).click();
  await expect(page.getByLabel('Active distribution board', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator('.view-tabs').getByRole('button', { name: 'Circuits', exact: true }).click();
  await expect(page.locator('.view-tabs').getByRole('button', { name: 'Circuits', exact: true })).toHaveClass(/active/);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(qaDir, 'language-mobile-en.png'), fullPage: true });
  await page.getByRole('button', { name: 'Open device library', exact: true }).click();
  await languageControl(page).selectOption('hu');
  await expect(page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true })).toHaveClass(/active/);
});

test('reopens production in English offline and switches both languages with cached manifests', async ({ page, context }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openPlanner(page, 'http://localhost:4173/');
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await languageControl(page).selectOption('en');
  await page.reload();
  await reopenRecentProject(page);
  await expect(languageControl(page)).toHaveValue('en');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const initial = await readDocument(page);
  await context.setOffline(true);
  await page.reload();
  await reopenRecentProject(page);
  await expect(languageControl(page)).toHaveValue('en');
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Socket outlet', exact: true })).toBeVisible();
  const englishManifest = await page.evaluate(async () => {
    const response = await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href);
    return response.json();
  });
  expect(englishManifest).toMatchObject({ name: 'VoltGecko', lang: 'en' });
  await languageControl(page).selectOption('hu');
  await expect(page.locator('.catalog-grid').getByRole('button', { name: 'Dugalj', exact: true })).toBeVisible();
  const hungarianManifest = await page.evaluate(async () => {
    const response = await fetch(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')!.href);
    return response.json();
  });
  expect(hungarianManifest).toMatchObject({ name: 'VoltGecko', lang: 'hu' });
  await languageControl(page).selectOption('en');
  await expect(page).toHaveTitle('VoltGecko');
  expect(await readDocument(page)).toEqual(initial);
  await page.screenshot({ path: path.join(qaDir, 'language-offline-en.png'), fullPage: true });
  expect(errors).toEqual([]);
});
