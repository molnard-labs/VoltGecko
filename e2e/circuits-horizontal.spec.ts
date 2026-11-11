import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

async function readCircuit(page: Page) {
  return page.evaluate(async () => new Promise<any>((resolve, reject) => {
    const open = indexedDB.open('villamos-tervezo-local');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, get = db.transaction('projects', 'readonly').objectStore('projects').get(localStorage.getItem('planner.activeProject'));
      get.onerror = () => reject(get.error);
      get.onsuccess = () => { const circuit = get.result.document.data.circuits[0]; db.close(); resolve(circuit); };
    };
  }));
}

test('edits circuit conductors and section without changing older cable details and scrolls cards horizontally', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await page.reload();
  // A synthetic old project has cable details and a descriptive free-text
  // cable. Neither is rewritten merely because the simplified editor opens.
  await page.evaluate(async () => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('villamos-tervezo-local');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects');
      const get = store.get(localStorage.getItem('planner.activeProject'));
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const row = get.result, circuit = row.document.data.circuits[0], board = row.document.data.boards[0];
        circuit.cable = 'H07V-U 3 × 2,5 mm²';
        circuit.cableDetails = { cores: 3, crossSectionMm2: 2.5, material: 'Cu', lengthM: 9 };
        circuit.phase = 'L'; circuit.loadType = 'lamp';
        board.wiring = { ...(board.wiring ?? { buses: [], wires: [] }), infeeds: [{ id: 'qa-feed', name: 'Betáp', kind: 'supply', poles: ['L', 'N', 'PE'] }] };
        store.put(row);
      };
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  const cards = page.locator('.circuit-cards');
  const section = page.getByLabel('ÁK1: Keresztmetszet (mm²)', { exact: true });
  await expect(section.locator('option')).toHaveText(['Nincs megadva', '1,5 mm²', '2,5 mm²', '4 mm²', '6 mm²']);
  await expect(section).toHaveValue('2.5');
  await expect(page.getByLabel('ÁK1 fázisa', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('ÁK1 fogyasztótípusa', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Részletes kábeladatok', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('ÁK1: L vezető', { exact: true })).toBeChecked();
  await expect(page.getByLabel('ÁK1: N vezető', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('ÁK1: PE vezető', { exact: true })).not.toBeChecked();
  await section.selectOption('4');
  await page.getByLabel('ÁK1: N vezető', { exact: true }).check();
  await expect.poll(async () => {
    const circuit = await readCircuit(page);
    return { cable: circuit.cable, cableDetails: circuit.cableDetails, phase: circuit.phase, loadType: circuit.loadType, conductors: circuit.conductors };
  }).toEqual({ cable: 'H07V-U 3 × 2,5 mm²', cableDetails: { cores: 3, crossSectionMm2: 4, material: 'Cu', lengthM: 9 }, phase: 'L', loadType: 'lamp', conductors: ['L', 'N'] });

  // Cards grow to their full height; only the workspace scrolls vertically.
  // This preserves one vertical scroll surface while the strip itself can
  // still be scrolled horizontally when a circuit is off-screen.
  const editor = page.locator('.editor-area');
  await expect(page.getByText('KÖZÖS PROJEKTADATOK', {exact: true})).toHaveCount(0);
  await expect(page.getByText('Az alaprajz és az elosztó közötti kapcsolat.', {exact: true})).toHaveCount(0);
  await expect.poll(() => cards.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await expect.poll(() => editor.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await expect.poll(() => page.locator('.workspace').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await editor.evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'tmp/circuit-ui-desktop.png' });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect.poll(() => cards.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect.poll(() => cards.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await expect.poll(() => page.locator('.workspace').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: 'tmp/circuit-ui-mobile.png' });
  await editor.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect.poll(() => editor.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await cards.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => cards.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: 'tmp/circuit-ui-mobile-fields.png' });
  await page.getByRole('button', { name: 'Új áramkör', exact: true }).click();
  const lastName = cards.locator('.circuit-card').last().locator('[data-circuit-name]');
  await expect(lastName).toBeFocused();
  await expect.poll(() => cards.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.reload();
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Áramkörök', exact: true }).click();
  await expect(section).toHaveValue('4');
  await expect(page.getByLabel('ÁK1: N vezető', { exact: true })).toBeChecked();
  expect((await readCircuit(page)).loadType).toBe('lamp');
});
