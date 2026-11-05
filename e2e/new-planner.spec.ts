import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const sample = path.join(process.cwd(), 'e2e', 'fixtures', 'kistarcsa-eloszto.json');
const projectName = 'Lakás + fogyasztásmérő szekrény';

test('imports the shared board, exports its single-line diagram and restores it after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Projekt', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Betöltés fájlból', exact: true }).click();
  await (await chooser).setFiles(sample);

  await expect(page.locator('#pname')).toHaveValue(projectName);
  await expect(page.locator('#cabsvg')).toContainText('Fogyasztásmérő');
  await expect(page.locator('#cabsvg')).toContainText('Lakáselosztó');
  await expect(page.locator('#cabsvg path').first()).toBeAttached();

  const expected = JSON.parse(await readFile(sample, 'utf8'));
  const savedProject = async () => page.evaluate(() => {
    const saved = localStorage.getItem('eloszto-tervezo-v2');
    return saved ? JSON.parse(saved) : null;
  });
  await expect.poll(async () => (await savedProject())?.project?.name).toBe(projectName);
  const imported = await savedProject();
  expect(['boxes', 'rows', 'comps', 'wires', 'bw', 'bb', 'stubs'].map(key => imported[key].length))
    .toEqual([2, 6, 39, 24, 22, 12, 3]);
  expect(imported.project).toEqual(expected.project);
  expect(imported.boxes.map((box: { name: string }) => box.name)).toEqual(expected.boxes.map((box: { name: string }) => box.name));
  expect(imported.comps.map(({ id, type, row, x, poles }: { id: number; type: string; row: number; x: number; poles: string }) => ({ id, type, row, x, poles })))
    .toEqual(expected.comps.map(({ id, type, row, x, poles }: { id: number; type: string; row: number; x: number; poles: string }) => ({ id, type, row, x, poles })));
  expect(imported.wires.map(({ id, a, b }: { id: number; a: unknown; b: unknown }) => ({ id, a, b })))
    .toEqual(expected.wires.map(({ id, a, b }: { id: number; a: unknown; b: unknown }) => ({ id, a, b })));

  await page.getByRole('tab', { name: 'Egyvonalas rajz' }).click();
  const diagram = page.locator('#sldwrap svg');
  await expect(diagram).toContainText('Egyvonalas kapcsolási rajz');
  await expect(diagram).toContainText(projectName);
  await expect(diagram).toContainText('Lakáselosztó');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'SVG mentése' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  const svg = await readFile(await download.path(), 'utf8');
  expect(svg).toContain('<svg');
  expect(svg).toContain('Egyvonalas kapcsolási rajz');
  expect(svg).toContain(projectName);

  // Wait for the debounced autosave before reloading the same browser session.
  await page.reload();
  await expect(page.locator('#pname')).toHaveValue(projectName);
  await expect(page.locator('#cabsvg')).toContainText('Fogyasztásmérő');
  expect(await savedProject()).toEqual(imported);
  await page.getByRole('tab', { name: 'Egyvonalas rajz' }).click();
  await expect(page.locator('#sldwrap svg')).toContainText('Lakáselosztó');
});

test('rejects injected identifiers without changing the project and safely renders imported colours', async ({ page }) => {
  const fixture = JSON.parse(await readFile(sample, 'utf8'));
  await page.goto('/');
  const upload = async (data: unknown) => {
    await page.getByRole('button', { name: 'Projekt', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Betöltés fájlból', exact: true }).click();
    await (await chooser).setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  };

  await upload(fixture);
  await expect(page.locator('#pname')).toHaveValue(projectName);
  await expect(page.locator('#cabsvg [data-comp]')).toHaveCount(39);
  const before = await page.locator('#cabsvg').innerHTML();
  const malicious = structuredClone(fixture);
  malicious.comps[0].id = 'unsafe" onpointerenter="window.__injected=1';
  await upload(malicious);
  await expect(page.locator('#toast')).toHaveText('Érvénytelen fájl');
  await expect(page.locator('#pname')).toHaveValue(projectName);
  expect(await page.locator('#cabsvg').innerHTML()).toBe(before);
  await expect(page.locator('#cabsvg [onpointerenter]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Bezár', exact: true }).click();

  const badColor = structuredClone(fixture);
  badColor.wires[0].color = '" onpointerenter="window.__injected=1';
  badColor.comps[0].name = '"><img src=x onerror="window.__injected=1">';
  await upload(badColor);
  await expect(page.locator('#toast')).toHaveText('Betöltve');
  await expect(page.locator('#cabsvg [data-comp]')).toHaveCount(39);
  await expect(page.locator('#cabsvg [onpointerenter], #cabsvg [onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { __injected?: number }).__injected)).toBeUndefined();
});

test('rolls back a malformed import that fails while drawing, preserving the selected project and autosave', async ({ page }) => {
  const fixture = JSON.parse(await readFile(sample, 'utf8'));
  await page.goto('/');
  const upload = async (data: unknown) => {
    await page.getByRole('button', { name: 'Projekt', exact: true }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Betöltés fájlból', exact: true }).click();
    await (await chooser).setFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  };
  await upload(fixture);
  await expect(page.locator('#pname')).toHaveValue(projectName);
  const chosen = page.locator('#cabsvg [data-comp]').first();
  const chosenId = await chosen.getAttribute('data-comp');
  await chosen.locator('rect').first().click({ position: { x: 4, y: 22 } });
  await expect(page.locator('#insp')).toBeVisible();
  const inspector = await page.locator('#insp').innerHTML();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('eloszto-tervezo-v2') || '{}').project?.name)).toBe(projectName);
  const before = await page.evaluate(() => localStorage.getItem('eloszto-tervezo-v2'));

  const malformed = structuredClone(fixture);
  malformed.project.name = 'Nem szabad menteni';
  // Passes project parsing, but the renderer attempts to read the null conductor.
  malformed.comps[0].infeed = { side: 'top', conductors: [null] };
  await upload(malformed);
  await expect(page.locator('#toast')).toHaveText('Érvénytelen fájl');
  await expect(page.locator('#pname')).toHaveValue(projectName);
  await expect(page.locator('#cabsvg [data-comp]')).toHaveCount(39);
  expect(await page.locator('#insp').innerHTML()).toBe(inspector);
  expect(await page.locator('#cabsvg [data-comp]').first().getAttribute('data-comp')).toBe(chosenId);
  await page.getByRole('button', { name: 'Bezár', exact: true }).click();
  // Wait beyond the debounced save and ensure no partially imported project persisted.
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => localStorage.getItem('eloszto-tervezo-v2'))).toBe(before);
  await page.reload();
  await expect(page.locator('#pname')).toHaveValue(projectName);
  await expect(page.locator('#cabsvg [data-comp]')).toHaveCount(39);
});
