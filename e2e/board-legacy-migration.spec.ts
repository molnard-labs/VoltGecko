import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function saved(page:Page):Promise<ProjectDocument> {
  return page.evaluate(async () => new Promise<ProjectDocument>((resolve,reject) => {
    const open=indexedDB.open('villamos-tervezo-local');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result, id=localStorage.getItem('planner.activeProject');
      const get=db.transaction('projects','readonly').objectStore('projects').get(id);
      get.onerror=()=>{db.close();reject(get.error);};
      get.onsuccess=()=>{const doc=get.result.document;db.close();resolve(doc);};
    };
  }));
}

test('preserves and resolves conflicting and unassigned legacy connections', async ({page}) => {
  await page.goto('/'); await chooseSample(page); await page.reload();
  await page.evaluate(async () => new Promise<void>((resolve,reject) => {
    const open=indexedDB.open('villamos-tervezo-local');
    open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{
      const db=open.result,tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects');
      const get=store.get(localStorage.getItem('planner.activeProject'));
      get.onerror=()=>reject(get.error);
      get.onsuccess=()=>{
        const row=get.result,data=row.document.data,sheet=data.sheets[0],board=data.boards[0];
        delete data.circuitBoardMigration;
        const find=(code:string)=>data.devices.find((device:{code:string})=>device.code===code).id;
        const connector=(deviceId:string)=>({kind:'device',deviceId,side:'bottom',pole:0});
        sheet.boardPlacements=[{boardId:board.id,x:300,y:250}];
        sheet.routes=[
          {id:'old-a',fromBoardId:board.id,toDeviceId:find('D1'),kind:'power',explicitCircuitId:data.circuits[0].id,points:[],boardTerminals:[{boardId:board.id,conductor:'L',endpoint:connector(find('QF1'))}],boardPositions:[{boardId:board.id,x:40,y:500}]},
          {id:'old-b',fromBoardId:board.id,toDeviceId:find('D2'),kind:'power',explicitCircuitId:data.circuits[0].id,points:[],boardTerminals:[{boardId:board.id,conductor:'L',endpoint:connector(find('QF2'))}],boardPositions:[{boardId:board.id,x:80,y:500}]},
          {id:'orphan',fromBoardId:board.id,toDeviceId:find('É1'),kind:'power',points:[],boardTerminals:[{boardId:board.id,conductor:'L',endpoint:connector(find('QF3'))}]},
        ];
        store.put(row);
      };
      tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>{db.close();reject(tx.error);};
    };
  }));
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const menu=page.locator('.board-circuit-menu');
  await menu.locator('summary').click();
  await expect(menu).toContainText('a korábbi L bekötések eltérnek');
  await menu.getByRole('button',{name:/QF1 · alsó 1/}).click();
  await menu.getByRole('button',{name:'1. korábbi hely használata'}).click();
  const orphan=menu.getByLabel(/^Korábbi bekötés 1/);
  const newCircuit=await orphan.locator('option').filter({hasText:'ÁK2'}).getAttribute('value');
  await orphan.selectOption(newCircuit!);
  await expect(orphan).toHaveCount(0);
  const doc=await saved(page), boardId=doc.data.boards[0].id;
  const first=doc.data.circuits[0].boardConnections!.find(item=>item.boardId===boardId)!;
  const second=doc.data.circuits[1].boardConnections!.find(item=>item.boardId===boardId)!;
  expect(first.terminals).toHaveLength(1);
  expect(first.legacyTerminalConflicts).toBeUndefined();
  expect(first.position).toEqual({x:40,y:500});
  expect(second.terminals).toHaveLength(1);
  expect(doc.data.sheets[0].routes.find(route=>route.id==='orphan')?.boardTerminals).toBeUndefined();
  await page.reload(); await reopenRecentProject(page);
  const reopened=await saved(page);
  expect(reopened.data.circuits[0].boardConnections).toEqual(doc.data.circuits[0].boardConnections);
  expect(reopened.data.circuits[1].boardConnections).toEqual(doc.data.circuits[1].boardConnections);
});

test('retains existing circuit visibility when adding another board', async ({page}) => {
  await page.goto('/'); await chooseSample(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
  const menu=page.locator('.board-circuit-menu');
  await menu.locator('summary').click();
  await menu.getByLabel(/ÁK3/).uncheck();
  await expect(page.locator('.wiring-circuit')).toHaveCount(2);
  await menu.locator('summary').click();
  page.once('dialog',dialog=>dialog.accept('Műhely'));
  await page.getByRole('button',{name:'Új elosztó',exact:true}).click();
  await expect(page.locator('.wiring-circuit')).toHaveCount(0);
  await page.getByLabel('Aktív elosztó',{exact:true}).selectOption({label:'Lakáselosztó'});
  await expect(page.locator('.wiring-circuit')).toHaveCount(2);
  await menu.locator('summary').click();
  await expect(menu.getByLabel(/ÁK3/)).not.toBeChecked();
  await menu.getByLabel(/ÁK3/).check();
  await expect(page.locator('.wiring-circuit')).toHaveCount(3);
});
