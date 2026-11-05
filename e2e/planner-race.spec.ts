import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('an old circuit acknowledgement cannot overwrite a newer edit', async ({ page }) => {
  await page.addInitScript(() => {
    window.addEventListener('message', event => {
      if (event.data?.type === 'voltgecko:change') (window as any).__lastPlannerChange = event.data;
    });
  });
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name: 'Elosztó', exact: true }).click();
  await page.getByRole('button', { name: 'Szekrényrajz', exact: true }).click();
  const frame = page.frameLocator('iframe[title="Elosztótervező"]');
  await frame.getByRole('button', { name: 'Kismegszakító 1P hozzáadása' }).click();
  await frame.locator('#cabsvg [data-comp] rect').first().click({ position: { x: 4, y: 22 } });
  await frame.getByRole('button', { name: 'Új közös áramkör' }).click();
  const name = frame.getByLabel('Áramkör / fogyasztó neve', { exact: true });
  await name.fill('Friss adat');
  await expect.poll(() => page.evaluate(() => (window as any).__lastPlannerChange?.snapshot?.comps?.[0]?.name)).toBe('Friss adat');
  await page.evaluate(() => {
    const change = (window as any).__lastPlannerChange;
    const id = change.snapshot.comps[0].vgCircuitId;
    const target = document.querySelector<HTMLIFrameElement>('iframe[title="Elosztótervező"]')!.contentWindow!;
    target.postMessage({ type: 'voltgecko:circuits', projectId: change.projectId, generation: change.generation,
      ackSequence: change.sequence - 1, circuits: [{ id, code:'ÁK1', name:'Korábbi érték' }] }, location.origin);
  });
  await expect(name).toHaveValue('Friss adat');
  await page.waitForTimeout(250);
  await expect(name).toHaveValue('Friss adat');
  await page.evaluate(() => {
    const change = (window as any).__lastPlannerChange;
    const id = change.snapshot.comps[0].vgCircuitId;
    const target = document.querySelector<HTMLIFrameElement>('iframe[title="Elosztótervező"]')!.contentWindow!;
    target.postMessage({ type: 'voltgecko:circuits', projectId: change.projectId, generation: change.generation,
      ackSequence: change.sequence, circuits: [{ id, code:'ÁK1', name:'Aktuális érték' }] }, location.origin);
  });
  await expect(name).toHaveValue('Aktuális érték');
});
