import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

test('keeps project settings, language and home in the sidebar on desktop and mobile', async ({ page }) => {
  await page.goto('/');
  await chooseSample(page);
  const sidebar = page.locator('.sidebar');
  await expect(sidebar.locator('.project-switch')).toBeVisible();
  await expect(sidebar.locator('.main-nav')).toHaveCount(0);
  await expect(sidebar.getByRole('button', { name:'Projektbeállítások', exact:true })).toBeVisible();
  await sidebar.getByRole('button', { name:'Projektbeállítások', exact:true }).click();
  await expect(page.getByLabel('Projekt neve', { exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Kész', exact:true }).click();
  const language = sidebar.getByLabel('Nyelv / Language', { exact:true });
  await expect(language).toHaveValue('hu');
  await language.selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang','en');
  await expect(sidebar.getByRole('button', { name:'Project settings', exact:true })).toBeVisible();
  await sidebar.getByRole('button', { name:'Start screen', exact:true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
  await reopenRecentProject(page);

  await page.setViewportSize({ width:390, height:844 });
  await page.getByRole('button', { name:'Open device library', exact:true }).click();
  await expect(sidebar).toBeVisible();
  await sidebar.getByRole('button', { name:'Project settings', exact:true }).click();
  await expect(page.getByLabel('Project name', { exact:true })).toBeVisible();
  await page.getByRole('button', { name:'Done', exact:true }).click();
  await page.getByRole('button', { name:'Open device library', exact:true }).click();
  await sidebar.getByLabel('Nyelv / Language', { exact:true }).selectOption('hu');
  await expect(page.locator('html')).toHaveAttribute('lang','hu');
  await sidebar.getByRole('button', { name:'Kezdőképernyő', exact:true }).click();
  await expect(page.locator('.start-screen')).toBeVisible();
});
