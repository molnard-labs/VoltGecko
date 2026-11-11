import { expect, test, type Page } from '@playwright/test';
import { chooseSample } from './startup';

async function selectSampleRoute(page: Page) {
  const line = page.locator('.floor-route polyline').first();
  await line.scrollIntoViewIfNeeded();
  const point = await line.evaluate(element => {
    const polyline = element as SVGPolylineElement;
    const middle = polyline.getPointAtLength(polyline.getTotalLength() / 2);
    const screen = new DOMPoint(middle.x, middle.y).matrixTransform(polyline.getScreenCTM()!);
    return { x:screen.x, y:screen.y };
  });
  await page.mouse.click(point.x, point.y);
}

test('selection actions are at the top without resizing the drawing', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const canvas = page.locator('.floor-svg');
  await canvas.scrollIntoViewIfNeeded();
  const before = await canvas.boundingBox();
  await selectSampleRoute(page);
  const host = page.locator('.workspace-toolbar .floor-context-host');
  const add = host.getByRole('button', { name:'Töréspont hozzáadása', exact:true });
  await expect(add).toBeVisible();
  const after = await canvas.boundingBox();
  expect(after!.x).toBeCloseTo(before!.x, 0);
  expect(after!.y).toBeCloseTo(before!.y, 0);
  expect(after!.height).toBeCloseTo(before!.height, 0);
  expect((await host.boundingBox())!.y).toBeLessThan(after!.y);
  await expect(page.locator('.floor-bottom-toolbar .floor-selection-tools')).toHaveCount(0);
  const bends = await page.locator('.floor-bend').count();
  await add.click();
  await expect(page.locator('.floor-bend')).toHaveCount(bends + 1);
});

test.describe('small screens', () => {
  test.use({ viewport:{ width:320, height:680 }, isMobile:true, hasTouch:true });
  test('keeps selected route actions visible while scrolling', async ({ page }) => {
    await page.goto('/');
    await chooseSample(page);
    await selectSampleRoute(page);
    const host = page.locator('.workspace-toolbar .floor-context-host');
    const add = host.getByRole('button', { name:'Töréspont hozzáadása', exact:true });
    await expect(add).toBeVisible();
    const scrolled = await page.locator('.workspace').evaluate(element => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    const bounds = await add.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
    await add.tap();
    await expect(page.locator('.floor-bend')).not.toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});
