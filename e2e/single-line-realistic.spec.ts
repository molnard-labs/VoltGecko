import { expect, test } from '@playwright/test';
import { chooseSample, reopenRecentProject } from './startup';
import path from 'node:path';

// Anonymous reproduction of the observed topology, not a copy of a user file.
// Old Easy9 devices deliberately have product snapshots but no electrical field.
test('renders a legacy product-based FI, reversed breaker feeds and eight N circuits', async ({page}) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => Object.defineProperty(window, 'showSaveFilePicker', {value:undefined,configurable:true}));
  await page.goto('/');
  await chooseSample(page);
  await page.reload();
  const before = await page.evaluate(async () => new Promise<unknown>((resolve,reject) => {
    const request=indexedDB.open('villamos-tervezo-local');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result,tx=db.transaction('projects','readwrite'),store=tx.objectStore('projects');
      const get=store.get(localStorage.getItem('planner.activeProject'));
      get.onerror=()=>reject(get.error);
      let fixture:unknown;
      get.onsuccess=()=>{
        const row=get.result,data=row.document.data,board=data.boards[0];
        const sampleFi=data.devices.find((d:{kind:string})=>d.kind==='rcd');
        const sampleQ=data.devices.find((d:{kind:string})=>d.kind==='breaker');
        const snapshot=(reference:string,poles:string)=>({reference,manufacturer:'Schneider Electric',range:'Easy9 Pro',
          sourceUrl:'https://www.se.com/',sourceDocument:'Easy9 Pro',sourcePage:6,verifiedAt:'2026-01-01',mounting:'din',poles});
        const fi={...structuredClone(sampleFi),id:'qa-fi2',code:'FI2',name:'Áram-védőkapcsoló',kind:'rcd',model:'Schneider Electric EZ9R49240',moduleWidth:2,product:snapshot('EZ9R49240','2P')};
        delete fi.electrical;
        const breakers=Array.from({length:7},(_,index)=>{
          const sku=index<2?'EZ9F27116':'EZ9F27113';
          const item={...structuredClone(sampleQ),id:`qa-qf${index+1}`,code:`QF${index+1}`,name:'Kismegszakító',kind:'breaker',model:`Schneider Electric ${sku}`,rating:index<2?'B16':'B13',moduleWidth:1,product:snapshot(sku,'1P')};
          delete item.electrical;return item;
        });
        const terminal=(id:string,code:string,conductor:string)=>({...structuredClone(sampleQ),id,code,name:'Főáramköri kapocs',kind:'custom',variant:'board-terminal',model:'',rating:'',moduleWidth:1,product:undefined,electrical:{role:'terminal',poles:[conductor]}});
        const x1=terminal('qa-x1','X1','N'),x2=terminal('qa-x2','X2','L'),x3=terminal('qa-x3','X3','PE');
        data.devices=[fi,...breakers,x1,x2,x3];
        board.rows[0].capacity=24;
        board.rows[0].placements=[{deviceId:fi.id,start:0},...breakers.map((d:{id:string},i:number)=>({deviceId:d.id,start:i+2})),{deviceId:x1.id,start:9},{deviceId:x2.id,start:10},{deviceId:x3.id,start:11}];
        const device=(id:string,side:string,pole=0)=>({kind:'device',deviceId:id,side,pole});
        const source=(pole:number)=>({kind:'infeed',infeedId:'qa-supply',pole});
        const bus=(busId:string,terminal:number)=>({kind:'bus',busId,terminal});
        const wire=(id:string,from:object,to:object)=>({id,from,to});
        board.connections=[];
        board.wiring={infeeds:[{id:'qa-supply',name:'Külső betáplálás',kind:'supply',poles:['L','N','PE']}],
          buses:[{id:'qa-n',name:'N sín',conductor:'N',capacity:12,position:'bottom',terminalLabels:[]},{id:'qa-pe',name:'PE sín',conductor:'PE',capacity:12,position:'bottom',terminalLabels:[]}],
          wires:[wire('l-in',source(0),device(x2.id,'bottom')),wire('l-fi',device(x2.id,'top'),device(fi.id,'top',0)),
            wire('n-in',source(1),device(x1.id,'bottom')),wire('n-fi',device(x1.id,'top'),device(fi.id,'top',1)),
            wire('pe-in',source(2),device(x3.id,'bottom')),wire('pe-bus',device(x3.id,'top'),bus('qa-pe',0)),
            wire('fi-n',device(fi.id,'bottom',1),bus('qa-n',0)),wire('fi-qf',device(fi.id,'bottom',0),device(breakers[0].id,'bottom')),
            ...breakers.slice(1).map((item:{id:string},i:number)=>wire(`comb-${i}`,device(breakers[i].id,'bottom'),device(item.id,'bottom')))]};
        const circuitTemplate=data.circuits[0];
        data.circuits=Array.from({length:8},(_,i)=>({...structuredClone(circuitTemplate),id:`qa-c${i+1}`,code:`ÁK${i+1}`,name:`Áramkör ${i+1}`,
          boardConnections:[{boardId:board.id,terminals:[...(i<7?[{conductor:'L',endpoint:device(breakers[i].id,'top')}]:[]),{conductor:'N',endpoint:bus('qa-n',i+1)}]}]}));
        data.circuitBoardMigration=true;
        fixture=structuredClone(data);store.put(row);
      };
      tx.onerror=()=>reject(tx.error);
      tx.oncomplete=()=>{db.close();resolve(fixture);};
    };
  }));
  await reopenRecentProject(page);
  await page.locator('.view-tabs').getByRole('button',{name:'Egyvonalas',exact:true}).click();
  const svg=page.locator('.single-line-svg svg');
  await expect(svg.locator('[data-device-id="qa-fi2"][data-conductor="L"]')).toHaveCount(1);
  await expect(svg.locator('[data-device-id="qa-fi2"][data-conductor="N"]')).toHaveCount(1);
  for(const id of ['qa-x1','qa-x2','qa-x3']){
    const terminal=svg.locator(`[data-device-id="${id}"][data-source-terminal="true"]`);
    await expect(terminal).toHaveCount(1);
    await expect(terminal.locator('title')).toContainText(/alsó 1.*felső 1/);
  }
  await expect(svg).not.toContainText('Pólusadat nincs megerősítve');
  for(let index=1;index<=7;index++){
    await expect(svg.locator(`[data-device-id="qa-qf${index}"][data-conductor="L"]`)).toHaveCount(1);
    const output=svg.locator(`[data-circuit-id="qa-c${index}"][data-circuit-port="L"]`);
    await expect(output).toHaveCount(1);
    await expect(output.locator('title')).toContainText(`QF${index} · felső 1 (L)`);
  }
  for(let index=1;index<=8;index++)await expect(svg.locator(`[data-circuit-id="qa-c${index}"][data-circuit-port="N"]`)).toHaveCount(1);
  await expect(svg.locator('[data-circuit-port="PE"]')).toHaveCount(0);
  await expect(svg.locator('[data-connection-id="pe-bus"]')).toContainText('PE sín');
  await expect(svg.locator('[data-connection-id="fi-qf"]')).toContainText('QF1 · alsó 1 (L)');
  const png=page.waitForEvent('download');
  await page.getByRole('button',{name:'PNG letöltése',exact:true}).click();
  await (await png).saveAs(path.resolve('tmp/anonymous-realistic-singleline.png'));
  await page.reload();await reopenRecentProject(page);
  const after=await page.evaluate(async()=>new Promise<unknown>((resolve,reject)=>{
    const open=indexedDB.open('villamos-tervezo-local');open.onerror=()=>reject(open.error);
    open.onsuccess=()=>{const db=open.result,request=db.transaction('projects','readonly').objectStore('projects').get(localStorage.getItem('planner.activeProject'));request.onerror=()=>reject(request.error);request.onsuccess=()=>{resolve(request.result.document.data);db.close();};};
  }));
  expect(after).toEqual(before);
});
