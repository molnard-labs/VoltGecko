import { expect, test } from '@playwright/test';
import { chooseSample } from './startup';

test('keeps fractional module widths readable in Hungarian and English without changing their exact value', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  await expect.poll(() => page.locator('.view-tabs').evaluate(element => ({
    verticalFits:element.scrollHeight <= element.clientHeight,
    horizontalFits:element.scrollWidth <= element.clientWidth + 1,
  }))).toEqual({verticalFits:true,horizontalFits:true});
  await page.locator('.view-tabs').getByRole('button', { name:'Elosztó', exact:true }).click();
  const card = page.locator('.board-catalog button').filter({ hasText:'Sorkapocs' });
  await expect(card.locator('small')).toHaveText('1,61 M');
  const fits = await card.locator('small').evaluate(element => {
    const label = element.getBoundingClientRect(), parent = element.parentElement!.getBoundingClientRect();
    return label.left >= parent.left && label.right <= parent.right;
  });
  expect(fits).toBe(true);
  await card.click();
  await expect.poll(() => page.evaluate(async () => {
    const id = localStorage.getItem('planner.activeProject')!;
    return new Promise<number>((resolve, reject) => {
      const request = indexedDB.open('villamos-tervezo-local');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('projects','readonly').objectStore('projects').get(id);
        get.onerror = () => reject(get.error);
        get.onsuccess = () => { resolve(get.result.document.data.devices.at(-1)?.moduleWidth); db.close(); };
      };
    });
  })).toBeCloseTo(29 / 18, 12);
  await page.getByLabel('Nyelv / Language', {exact:true}).selectOption('en');
  await expect(page.locator('.board-catalog button').filter({hasText:'Terminal block'}).locator('small')).toHaveText('1.61 M');
  await page.locator('.view-tabs').getByRole('button', {name:'History',exact:true}).click();
  await expect(page.locator('.history-count')).toHaveText('Saved versions: 1');
});

test('shows complete mobile view tabs without a second scrollbar', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await page.goto('/');
  await chooseSample(page);
  const tabs = page.locator('.view-tabs');
  for (const name of ['Alaprajz','Elosztó','Áramkörök']) {
    await tabs.getByRole('button', {name,exact:true}).click();
    await expect.poll(async () => tabs.evaluate(element => {
      const tab = element.querySelector<HTMLElement>('[aria-current="page"]')!;
      const bounds = element.getBoundingClientRect(), active = tab.getBoundingClientRect();
      return active.left >= bounds.left - .5 && active.right <= bounds.right + .5 && element.scrollHeight <= element.clientHeight;
    })).toBe(true);
  }
  await tabs.getByRole('button', {name:'Előzmények',exact:true}).click();
  await expect(page.locator('.history-count')).toHaveText('1 mentett változat');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

for (const { width, height, mobile } of [
  { width:1512, height:982, mobile:false },
  { width:1280, height:720, mobile:false },
  { width:390, height:844, mobile:true },
  { width:320, height:568, mobile:true },
]) {
  test(`keeps a single reachable sidebar scrollbar at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({width,height});
    await page.goto('/');
    await chooseSample(page);
    if (mobile) await page.getByRole('button', {name:'Eszköztár megnyitása',exact:true}).click();
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.sidebar-content')).toBeVisible();
    const count = await sidebar.evaluate(element => [element, ...element.querySelectorAll<HTMLElement>('*')].filter(item => {
      const style = getComputedStyle(item);
      return ['auto','scroll'].includes(style.overflowY) && item.scrollHeight > item.clientHeight + 1;
    }).length);
    expect(count).toBe(1);
    const project = sidebar.getByRole('button', {name:'Projektbeállítások',exact:true});
    const language = sidebar.getByLabel('Nyelv / Language', {exact:true});
    if (height > 800) {
      await expect(project).toBeInViewport();
      await expect(language).toBeInViewport();
    }
    await sidebar.getByLabel('Eszköz keresése', {exact:true}).scrollIntoViewIfNeeded();
    await expect(sidebar.getByLabel('Eszköz keresése', {exact:true})).toBeInViewport();
    await language.scrollIntoViewIfNeeded();
    await expect(language).toBeInViewport();
    await project.scrollIntoViewIfNeeded();
    await expect(project).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
