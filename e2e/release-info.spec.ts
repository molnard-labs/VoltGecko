import { expect, test, type Locator } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';

async function stamp(locator:Locator){
  return {commit:await locator.getAttribute('data-commit'),committedAt:await locator.getAttribute('data-committed-at'),dirty:await locator.getAttribute('data-dirty'),development:await locator.getAttribute('data-development')};
}

async function expectExactLink(locator:Locator){
  const metadata=await stamp(locator);expect(metadata.commit).toMatch(/^[a-f0-9]{40}$/);expect(Number.isFinite(Date.parse(metadata.committedAt!))).toBe(true);
  if(metadata.dirty==='true'){
    await expect(locator.locator('a')).toHaveCount(0);await expect(locator.locator('time')).toHaveCount(0);
  }else{
    await expect(locator.locator('a')).toHaveAttribute('href',`https://github.com/molnard-labs/VoltGecko/commit/${metadata.commit}`);
    await expect(locator.locator('time')).toHaveAttribute('datetime',metadata.committedAt!);
    await expect(locator.locator('time')).not.toContainText(/Budapest|Europe|\(|\)/);
  }
  return metadata;
}

test('the production stamp keeps its exact build commit across language changes, workspace navigation and offline reloads',async({page,context})=>{
  test.setTimeout(60_000);let remoteLookups=0;page.on('request',request=>{if(/https:\/\/(?:api\.)?github\.com\//.test(request.url()))remoteLookups++;});
  await page.goto('http://localhost:4173/');const start=page.locator('.start-footer .release-info');await expect(start).toBeVisible();const initial=await expectExactLink(start);expect(initial.development).toBe('false');
  await page.getByLabel('Nyelv / Language',{exact:true}).selectOption('en');await expect(start).toContainText(initial.dirty==='true'?'Local, uncommitted version':'Software last updated');expect(await stamp(start)).toEqual(initial);
  await chooseSample(page);const editor=page.locator('.sidebar-release .release-info');await expect(editor).toBeVisible();await expect(page.locator('.sidebar-release')).toContainText('v0.1.0');await expect(page.locator('.sidebar-bottom')).not.toContainText('Your data. Your device.');expect(await expectExactLink(editor)).toEqual(initial);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});await page.reload();await reopenRecentProject(page);await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.reload();await reopenRecentProject(page);expect(await expectExactLink(editor)).toEqual(initial);await expect(page.locator('.statusbar')).toContainText('Offline');expect(remoteLookups).toBe(0);
});

test('the visible update stamp stays readable and wraps within a narrow phone',async({page})=>{
  await page.setViewportSize({width:320,height:740});await page.goto('/');await page.locator('.start-footer .release-info').scrollIntoViewIfNeeded();await expect(page.locator('.start-footer .release-info')).toBeVisible();
  expect(await page.locator('.release-info').evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await chooseSample(page);await page.getByRole('button',{name:'Eszköztár megnyitása'}).click();const release=page.locator('.sidebar-release .release-info');await expect(release).toBeVisible();
  expect(await release.evaluate(element=>parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(14);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
