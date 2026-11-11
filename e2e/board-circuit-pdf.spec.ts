import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { chooseSample } from './startup';

test('exports circuit terminal connections and their single-line drawing without a route schedule', async ({page},testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const diagram=page.locator('.wiring-diagram');
  const circuit=diagram.locator('.wiring-circuit').filter({hasText:'ÁK1'});
  await circuit.getByRole('button',{name:/^L · ÁK1.*áramköri végpont/}).click();
  await diagram.getByRole('button',{name:'QF1 · alsó 1 (L)',exact:true}).click();
  await expect(diagram.locator('[data-circuit-link][data-conductor="L"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Mentés és export',exact:true}).click();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:/Részletes szakmai PDF/}).click();
  const path=testInfo.outputPath('circuit-board.pdf');
  await (await download).saveAs(path);
  const loading=getDocument({data:new Uint8Array(await readFile(path)),useSystemFonts:true});
  const pdf=await loading.promise;
  try {
    const pages=await Promise.all(Array.from({length:pdf.numPages},(_,index)=>pdf.getPage(index+1).then(page=>page.getTextContent())));
    const content=pages.flatMap(page=>page.items.map(item=>'str' in item?item.str:'')).join(' ');
    expect(content).toContain('Lakáselosztó · áramköri csatlakozások');
    expect(content).toContain('QF1 · alsó 1 (L)');
    expect(content).toContain('Lakáselosztó · egyvonalas rajz');
    expect(content).not.toContain('Kapcsolatjegyzék');
  } finally { await loading.destroy(); }
});


test('exports a diagram for a cabinet containing only unconnected devices', async ({page}, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }));
  await page.goto('/');
  await chooseSample(page);
  await page.getByRole('button', { name: 'Mentés és export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /Részletes szakmai PDF/ }).click();
  const filename = testInfo.outputPath('unconnected-board.pdf');
  await (await downloading).saveAs(filename);
  const loading = getDocument({ data: new Uint8Array(await readFile(filename)), useSystemFonts: true });
  const pdf = await loading.promise;
  try {
    const pageTexts = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then(page => page.getTextContent())));
    const content = pageTexts.flatMap(page => page.items.map(item => 'str' in item ? item.str : '')).join(' ');
    expect(content).toContain('Lakáselosztó · egyvonalas rajz');
  } finally { await loading.destroy(); }
});
