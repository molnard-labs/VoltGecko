import { expect, test, type Page } from '@playwright/test';
import { chooseSample } from './startup';

async function exerciseToolbar(page: Page) {
  await page.goto('/');
  await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button', { name:'Áramkörök', exact:true }).click();
  const toolbar = page.locator('.workspace-header');
  const add = page.getByRole('button', { name:'Új áramkör', exact:true });
  await expect(add).toHaveCount(1);
  // Create enough real cards that the page must scroll, then return to the top.
  for (let index = 0; index < 5; index++) await add.click();
  await expect(page.locator('.circuit-card')).toHaveCount(8);
  await expect(page.getByLabel('ÁK8 neve', {exact:true})).toBeFocused();
  await page.getByLabel('ÁK8 neve', {exact:true}).fill('Konyha új kör');
  await page.locator('.circuit-cards').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.workspace').evaluate(element => { element.scrollTop = 0; });
  await page.locator('.circuit-cards').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.locator('.workspace').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(add).toBeInViewport();
  const geometry = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace')!, editor = document.querySelector('.circuit-cards')!;
    const bar = document.querySelector('.workspace-header')!;
    return {workspaceTop: workspace.getBoundingClientRect().top, barTop: bar.getBoundingClientRect().top,
      editorScroll: editor.scrollTop, workspaceScroll: workspace.scrollTop};
  });
  expect(geometry.editorScroll + geometry.workspaceScroll).toBeGreaterThan(0);
  expect(geometry.barTop).toBeGreaterThanOrEqual(geometry.workspaceTop - 1);
  await expect(toolbar).toBeInViewport();
  await add.click();
  await expect(page.locator('.circuit-card')).toHaveCount(9);
  await expect(page.getByLabel('ÁK9 neve', {exact:true})).toBeFocused();
  await expect(page.getByLabel('ÁK9 neve', {exact:true})).toBeInViewport();
  const barBox = (await toolbar.boundingBox())!, nameBox = (await page.getByLabel('ÁK9 neve', {exact:true}).boundingBox())!;
  expect(nameBox.y).toBeGreaterThanOrEqual(barBox.y + barBox.height - 1);
  expect(barBox.height).toBeLessThan(200);
  await expect(page.getByLabel('ÁK8 neve', {exact:true})).toHaveValue('Konyha új kör');
  await page.getByRole('button', {name:'Visszavonás',exact:true}).click();
  await expect(page.locator('.circuit-card')).toHaveCount(8);
}

test('keeps the circuit action available while scrolling and opens the new card', async ({page}) => {
  await exerciseToolbar(page);
});

test.describe('small screen', () => {
  test.use({viewport:{width:320,height:568}, isMobile:true, hasTouch:true});
  test('keeps the circuit action accessible without covering the editor', async ({page}) => {
    await exerciseToolbar(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const editor = page.locator('.editor-area');
    await expect(editor).toBeInViewport();
    expect((await editor.boundingBox())!.height).toBeGreaterThan(100);
  });
});
