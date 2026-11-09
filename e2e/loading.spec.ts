import { expect, test, type Page } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { jsPDF } from 'jspdf';
import { chooseSample, reopenRecentProject } from './startup';

interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
}

const featureSources = [
  'src/app/ManufacturerLibrary.tsx',
  'src/components/BoardEditor.tsx',
  'src/components/SingleLine.tsx',
  'src/services/import.ts',
  'src/services/pdf.ts',
] as const;

const readManifest = (): Record<string, ManifestChunk> => JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'));

function featureChunks() {
  const manifest = readManifest();
  const collect = (keys: string[], dynamic = false, seen = new Set<string>()): Set<string> => {
    for (const key of keys) {
      if (seen.has(key)) continue;
      seen.add(key);
      const chunk = manifest[key];
      expect(chunk, `Missing build manifest entry: ${key}`).toBeDefined();
      collect([...(chunk.imports ?? []), ...(dynamic ? chunk.dynamicImports ?? [] : [])], dynamic, seen);
    }
    return seen;
  };
  const initial = collect(Object.keys(manifest).filter(key => manifest[key].isEntry));
  const entries = featureSources.map(source => {
    const name = source.split('/').at(-1)!.replace(/\.[^.]+$/, '');
    const matches = Object.entries(manifest).filter(([key, chunk]) =>
      key === source || chunk.src === source || !chunk.src && chunk.isDynamicEntry && chunk.name === name);
    expect(matches, `Missing unique lazy build entry for ${source}`).toHaveLength(1);
    const [key, chunk] = matches[0];
    expect(chunk).toMatchObject({ isDynamicEntry: true });
    expect(initial.has(key), `${source} must not be in the initial static import graph`).toBe(false);
    return key;
  });
  const files = [...collect(entries, true, new Set(initial))]
    .filter(key => !initial.has(key))
    .map(key => manifest[key].file);
  return { files, entryFiles: entries.map(key => manifest[key].file) };
}

async function loadedFeatureScripts(page: Page, files: string[]) {
  return page.evaluate(expected => performance.getEntriesByType('resource')
    .filter(entry => ['script', 'link'].includes((entry as PerformanceResourceTiming).initiatorType))
    .map(entry => new URL(entry.name).pathname.slice(1))
    .filter(file => expected.includes(file)), files);
}

test('precaches lazy features without loading them on welcome, then opens each for the first time offline', async ({ page, context }) => {
  test.setTimeout(120_000);
  const { files, entryFiles } = featureChunks();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('http://localhost:4173/');
  await expect(page.getByRole('heading', { name: 'Mivel szeretnél kezdeni?', exact: true })).toBeVisible();
  await expect(page.getByText('Offline használatra kész', { exact: true })).toBeVisible({ timeout: 45_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  expect(await loadedFeatureScripts(page, files)).toEqual([]);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  // Worker precaching must not turn optional features into document script/modulepreload requests.
  expect(await loadedFeatureScripts(page, files)).toEqual([]);
  expect(await page.evaluate(async expected => {
    const missing = await Promise.all(expected.map(async file =>
      await caches.match(new URL(file, location.href).href, { ignoreSearch: true }) ? null : file));
    return missing.filter(file => file !== null);
  }, files)).toEqual([]);

  await context.setOffline(true);
  await chooseSample(page);
  await expect(page.locator('.floor-device')).toHaveCount(8);
  await expect(page.locator('.statusbar').getByText('Offline', { exact: true })).toBeVisible();
  expect(await loadedFeatureScripts(page, entryFiles)).toEqual([]);

  await page.locator('.manufacturer-library-button').click();
  const library = page.getByRole('dialog', { name: 'Gyártói termékkönyvtár', exact: true });
  await library.getByRole('searchbox').fill('EZ9F57116');
  await expect(library.locator('.product-reference')).toHaveText('EZ9F57116');
  await expect(library.locator('.product-image')).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await expect(library.getByText('Termékcsalád illusztrációja')).toBeVisible();
  await library.getByRole('button', { name: 'Termékkönyvtár bezárása', exact: true }).click();
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await expect(page.locator('rect.wiring-device')).toHaveCount(6);
  await page.locator('.view-tabs').getByRole('button', { name: 'Egyvonalas', exact: true }).click();
  await expect(page.locator('.single-line-svg [data-device-id]')).toHaveCount(6);

  await page.locator('.view-tabs').getByRole('button', { name: 'Alaprajz', exact: true }).click();
  const pdf = new jsPDF();
  pdf.text('First offline import', 20, 20);
  await page.locator('input[type=file][accept="application/pdf,image/png,image/jpeg"]').setInputFiles({
    name: 'offline-first.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf.output('arraybuffer')),
  });
  await expect(page.getByLabel('Aktív tervlap', { exact: true }).locator('option')).toHaveCount(2, { timeout: 25_000 });
  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Részletes szakmai PDF', exact: false }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const filename = test.info().outputPath('first-offline-export.pdf');
  await download.saveAs(filename);
  expect((await readFile(filename)).subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(await loadedFeatureScripts(page, entryFiles)).toEqual(expect.arrayContaining(entryFiles));

  await page.reload();
  await reopenRecentProject(page);
  await expect(page.getByLabel('Aktív tervlap', { exact: true }).locator('option')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('production JavaScript chunks stay within the default Vite 500 kB warning budget', () => {
  const files = [...new Set(Object.values(readManifest()).map(chunk => chunk.file).filter(file => file.endsWith('.js')))];
  expect(files.length).toBeGreaterThan(0);
  const oversized = files.map(file => ({ file, bytes: statSync(`dist/${file}`).size }))
    .filter(chunk => chunk.bytes > 500_000);
  expect(oversized).toEqual([]);
});
