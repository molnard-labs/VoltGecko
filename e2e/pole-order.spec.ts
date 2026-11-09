import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function readDocument(page:Page):Promise<ProjectDocument>{
  return page.evaluate(async()=>{
    const id=localStorage.getItem('planner.activeProject');if(!id)throw new Error('No project');
    return new Promise<ProjectDocument>((resolve,reject)=>{
      const request=indexedDB.open('villamos-tervezo-local');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get(id);
        get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();resolve(get.result.document);};};
    });
  });
}

test('legacy RCD remains connected when neutral is drawn left and electrical fields are edited',async({page})=>{
  await page.goto('/');await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const data=(await readDocument(page)).data,device=data.devices.find(item=>item.kind==='rcd')!;
  expect(device.electrical).toBeUndefined();
  const left=page.getByRole('button',{name:`${device.code} · felső 1 (N)`,exact:true}).locator('.wiring-terminal-hit');
  const right=page.getByRole('button',{name:`${device.code} · felső 2 (L)`,exact:true}).locator('.wiring-terminal-hit');
  expect(Number(await left.getAttribute('cx'))).toBeLessThan(Number(await right.getAttribute('cx')));
  await page.getByRole('button',{name:'Sín hozzáadása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.buses.length).toBe(1);
  const bus=(await readDocument(page)).data.boards[0].wiring!.buses[0];
  const terminal={kind:'device',deviceId:device.id,side:'top',pole:1};
  await page.getByLabel('Vezeték kezdőpontja',{exact:true}).selectOption(JSON.stringify(terminal));
  await page.getByLabel('Vezeték végpontja',{exact:true}).selectOption(JSON.stringify({kind:'bus',busId:bus.id,terminal:0}));
  await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring!.wires.length).toBe(1);
  await page.locator(`.wiring-device-group[data-device-id="${device.id}"] .wiring-device`).click();
  await page.locator('.electrical-device-fields>summary').click();
  await expect(page.getByLabel('Pólusok: 1. pólus',{exact:true})).toHaveValue('N');
  await expect(page.getByLabel('Pólusok: 2. pólus',{exact:true})).toHaveValue('L');
  await page.getByLabel('Névleges áram (A)',{exact:true}).fill('40');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(item=>item.id===device.id)?.electrical?.physicalPoleOrder).toEqual([1,0]);
  await page.getByLabel('Pólusok: 2. pólus',{exact:true}).selectOption('L1');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(item=>item.id===device.id)?.electrical?.poles).toEqual(['L1','N']);
  await page.getByLabel('Pólusok: Pólusok száma',{exact:true}).fill('3');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(item=>item.id===device.id)?.electrical?.physicalPoleOrder).toEqual([1,0,2]);
  const saved=await readDocument(page);
  expect(saved.data.devices.find(item=>item.id===device.id)!.electrical!.poles).toEqual(['L1','N','L']);
  expect(saved.data.boards[0].wiring!.wires[0].from).toEqual(terminal);
  await page.reload();await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  await expect(left).toBeVisible();await expect(page.getByRole('button',{name:`${device.code} · felső 2 (L1)`,exact:true})).toBeVisible();
  expect((await readDocument(page)).data.boards[0].wiring!.wires[0].from).toEqual(terminal);
});
