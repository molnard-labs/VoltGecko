import { expect, test, type Page } from '@playwright/test';
import type { ProjectDocument } from '../src/types';
import { chooseSample, reopenRecentProject } from './startup';

async function readDocument(page:Page):Promise<ProjectDocument>{
  return page.evaluate(async()=>{
    const id=localStorage.getItem('planner.activeProject');if(!id)throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve,reject)=>{const request=indexedDB.open('villamos-tervezo-local');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get(id);get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();if(!get.result?.document)reject(new Error('No saved document'));else resolve(get.result.document);};};});
  });
}

async function openBoard(page:Page){await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();}

test('preserves the exact four-pole neutral terminal in either selection order and saves editable routes',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await chooseSample(page);await openBoard(page);
  const original=await readDocument(page),main=original.data.devices.find(device=>device.code==='Q1')!;
  await page.locator('.wiring-device-group').filter({hasText:'Q1'}).click();
  await page.locator('.electrical-device-fields>summary').click();
  await page.getByLabel('Pólusok: Pólusok száma',{exact:true}).fill('4');
  for(const [index,pole] of ['L1','L2','L3','N'].entries())await page.getByLabel(`Pólusok: ${index+1}. pólus`,{exact:true}).selectOption(pole);
  await page.getByLabel('Névleges áram (A)',{exact:true}).fill('40');
  await page.getByRole('button',{name:'Sín hozzáadása',exact:true}).click();
  await page.locator('.wiring-item>summary').filter({hasText:'Új sín'}).click();
  await page.getByLabel('1. sín kapacitása',{exact:true}).fill('6');
  await page.getByRole('button',{name:'Q1 · felső 4 (N)',exact:true}).click();
  await page.getByRole('button',{name:'Új sín · 1 (N)',exact:true}).click();
  await expect(page.getByLabel('Vezeték kezdőpontja',{exact:true})).toHaveValue(JSON.stringify({kind:'device',deviceId:main.id,side:'top',pole:3}));
  await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await page.getByRole('button',{name:'Új sín · 6 (N)',exact:true}).click();
  await page.getByRole('button',{name:'Q1 · alsó 4 (N)',exact:true}).click();
  await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.wires.length).toBe(2);
  const wires=(await readDocument(page)).data.boards[0].wiring!.wires;
  expect(wires[0].from).toEqual({kind:'device',deviceId:main.id,side:'top',pole:3});
  expect(wires[1].to).toEqual({kind:'device',deviceId:main.id,side:'bottom',pole:3});
  expect(wires[1].from).toMatchObject({kind:'bus',terminal:5});
  await page.getByLabel('Vezeték felirata',{exact:true}).fill('N összekötés');
  await page.getByLabel('Kábel: Kábel megnevezése',{exact:true}).fill('H07V-K');
  await page.getByLabel('Kábel: Érszám',{exact:true}).fill('1');
  await page.getByLabel('Kábel: Keresztmetszet (mm²)',{exact:true}).fill('6');
  await page.getByLabel('Kábel: Hossz (m)',{exact:true}).fill('2');
  await expect(page.locator('.wiring-wire-editor')).toContainText('Feszültségesés-becsléshez');
  await page.getByLabel('Kábel: Gyártói ellenállás (Ω/km)',{exact:true}).fill('3.39');
  await expect(page.locator('.wiring-wire-editor')).toContainText('Becsült feszültségesés:');
  await page.getByRole('button',{name:'Rácshoz illesztés'}).click();
  await page.getByLabel('1. töréspont x',{exact:true}).fill('310');
  await page.getByLabel('1. töréspont y',{exact:true}).fill('290');
  const handle=page.getByTestId('wire-bend-0');await handle.scrollIntoViewIfNeeded();const bounds=await handle.boundingBox();if(!bounds)throw new Error('No bend handle');
  await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width/2+25,bounds.y+bounds.height/2+15,{steps:5});await page.mouse.up();
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring!.wires[1].points?.[0]).toEqual({x:335,y:305});
  await page.getByLabel('Felirat x',{exact:true}).fill('28');
  await page.getByLabel('Felirat y',{exact:true}).fill('14');
  await page.getByLabel('1. sín kapacitása',{exact:true}).fill('2');
  await expect(page.getByRole('alert')).toContainText('A kapacitás nem csökkenthető');
  await expect(page.getByLabel('1. sín kapacitása',{exact:true})).toHaveValue('6');
  expect((await readDocument(page)).data.boards[0].wiring!.wires).toHaveLength(2);
  await page.reload();await reopenRecentProject(page);await openBoard(page);
  await page.locator('.wiring-wire-list').getByRole('button',{name:'N összekötés',exact:true}).click();
  const saved=(await readDocument(page)).data.boards[0].wiring!.wires[1];expect(saved.points?.[0]).toEqual({x:335,y:305});expect(saved.labelOffset).toEqual({x:28,y:14});expect(saved.cable).toMatchObject({designation:'H07V-K',cores:1,crossSectionMm2:6,lengthM:2,resistanceOhmPerKm:3.39});
  expect((await readDocument(page)).data.sheets).toEqual(original.data.sheets);expect((await readDocument(page)).data.boards[0].connections).toEqual(original.data.boards[0].connections);
  await expect(page.locator('rect.wiring-device')).toHaveCount(6);await page.locator('.wiring-device-group').filter({hasText:'Q1'}).click();await page.getByLabel('Névleges adatok',{exact:true}).fill('4P 40 A');await expect.poll(async()=>(await readDocument(page)).data.devices.find(device=>device.id===main.id)?.rating).toBe('4P 40 A');
  expect(errors).toEqual([]);
});

test('offers an English keyboard form for cabinet terminals on a narrow screen',async({page})=>{
  await page.setViewportSize({width:700,height:950});await page.addInitScript(()=>localStorage.setItem('planner.language','en'));await page.goto('/');await chooseSample(page);await page.locator('.view-tabs').getByRole('button',{name:'Distribution board',exact:true}).click();
  await expect(page.getByLabel('Wire start terminal',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add bus',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('creates useful device presets and keeps a bus used by another cabinet',async({page})=>{
  await page.goto('/');await chooseSample(page);await openBoard(page);
  const original=await readDocument(page),firstBoardId=original.data.boards[0].id;
  await page.getByRole('button',{name:'Sín hozzáadása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.buses.length).toBe(1);
  const bus=(await readDocument(page)).data.boards[0].wiring!.buses[0];
  page.once('dialog',dialog=>dialog.accept('Melléképület'));await page.getByRole('button',{name:'Új elosztó',exact:true}).click();
  await page.getByRole('button',{name:'Sorkapocs hozzáadása',exact:true}).click();
  await page.getByRole('button',{name:'Motorvédő hozzáadása',exact:true}).click();
  await page.getByRole('button',{name:'Fogyasztásmérő hozzáadása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.devices.length).toBe(original.data.devices.length+3);
  const project=await readDocument(page),terminal=project.data.devices.find(device=>device.code==='XT1')!;
  expect(terminal.moduleWidth).toBeCloseTo(29/18);expect(terminal.electrical?.commonPoleGroups).toBeUndefined();
  await page.locator('.wiring-device-group').filter({hasText:'XT1'}).click();
  await page.locator('.electrical-device-fields>summary').click();
  await page.getByLabel('Pólusok: 2. pólus',{exact:true}).selectOption('N');
  await expect(page.getByLabel('Pólusok: 1. pólus',{exact:true})).toHaveValue('L1');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(device=>device.id===terminal.id)?.electrical?.poles).toEqual(['L1','N']);
  expect(project.data.devices.find(device=>device.code==='QM1')?.electrical).toMatchObject({role:'mpcb',poles:['L1','L2','L3']});
  expect(project.data.devices.find(device=>device.code==='EM1')?.electrical).toMatchObject({role:'meter',poles:['L1','L2','L3','N']});
  await page.getByLabel('Vezeték kezdőpontja',{exact:true}).selectOption(JSON.stringify({kind:'bus',busId:bus.id,terminal:0}));
  await page.getByLabel('Vezeték végpontja',{exact:true}).selectOption(JSON.stringify({kind:'device',deviceId:terminal.id,side:'top',pole:0}));
  await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).data.boards[1].wiring?.wires.length).toBe(1);
  await page.getByLabel('Aktív elosztó',{exact:true}).selectOption(firstBoardId);
  await page.locator('.wiring-item>summary').filter({hasText:'Új sín'}).click();await page.getByRole('button',{name:'Sín törlése',exact:true}).click();
  await expect(page.locator('.toast')).toContainText('A sínhez vezeték kapcsolódik');expect((await readDocument(page)).data.boards[0].wiring!.buses).toHaveLength(1);
  await page.getByRole('button',{name:'Betáplálás hozzáadása',exact:true}).click();await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.infeeds.length).toBe(1);
  const source=(await readDocument(page)).data.boards[0].wiring!.infeeds[0];
  await page.getByLabel('Vezeték kezdőpontja',{exact:true}).selectOption(JSON.stringify({kind:'infeed',infeedId:source.id,pole:0}));
  await page.locator('.wiring-item>summary').filter({hasText:'Külső betáplálás'}).click();await page.getByRole('button',{name:'Betáplálás törlése',exact:true}).click();
  await page.getByLabel('Vezeték végpontja',{exact:true}).selectOption(JSON.stringify({kind:'device',deviceId:terminal.id,side:'bottom',pole:0}));await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('A kiválasztott csatlakozópont megváltozott');expect((await readDocument(page)).data.boards[0].wiring!.wires).toHaveLength(0);
});

test('assigns an unassigned single-phase device from a phase bus in either order and preserves explicit choices',async({page})=>{
  await page.goto('/');await chooseSample(page);
  const original=await readDocument(page),device=(code:string)=>original.data.devices.find(item=>item.code===code)!;
  await page.locator('.view-tabs').getByRole('button',{name:'Áramkörök',exact:true}).click();
  for(const [index,power]of [1200,900,800].entries())await page.getByLabel(`${original.data.circuits[index].code} teljesítménye`,{exact:true}).fill(String(power));
  await page.getByLabel(`${original.data.circuits[2].code} fázisa`,{exact:true}).selectOption('L1');
  await openBoard(page);
  for(const [index,conductor]of ['L2','L3'].entries()){
    await page.getByRole('button',{name:'Sín hozzáadása',exact:true}).click();await page.locator('.wiring-item>summary').nth(index).click();await page.getByLabel(`${index+1}. sín vezetője`,{exact:true}).selectOption(conductor);
  }
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.buses.length).toBe(2);
  const buses=(await readDocument(page)).data.boards[0].wiring!.buses;
  const bus=(index:number,terminal:number)=>({kind:'bus',busId:buses[index].id,terminal});
  const endpoint=(code:string,pole=0,side='top')=>({kind:'device',deviceId:device(code).id,side,pole});
  const connect=async(from:object,to:object)=>{await page.getByLabel('Vezeték kezdőpontja',{exact:true}).selectOption(JSON.stringify(from));await page.getByLabel('Vezeték végpontja',{exact:true}).selectOption(JSON.stringify(to));await page.getByRole('button',{name:'Vezeték létrehozása',exact:true}).click();};
  await connect(endpoint('QF1'),bus(0,0));await connect(bus(1,0),endpoint('QF2'));
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(item=>item.id===device('QF1').id)?.electrical?.phase).toBe('L2');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(item=>item.id===device('QF2').id)?.electrical?.phase).toBe('L3');
  await expect(page.locator('.wiring-phase>div>span').filter({hasText:'L2'})).toContainText(/1\s?200 W/);await expect(page.locator('.wiring-phase>div>span').filter({hasText:'L3'})).toContainText('900 W');
  await connect(endpoint('QF3'),bus(0,1));await connect(endpoint('QF1',0,'bottom'),bus(1,1));await connect(endpoint('Q1',1),bus(0,2));await connect(endpoint('SPD1'),bus(0,3));
  await page.getByRole('button',{name:'Betáplálás hozzáadása',exact:true}).click();await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring?.infeeds.length).toBe(1);const source=(await readDocument(page)).data.boards[0].wiring!.infeeds[0];await connect({kind:'infeed',infeedId:source.id,pole:1},endpoint('FI1'));
  await expect.poll(async()=>(await readDocument(page)).data.boards[0].wiring!.wires.length).toBe(7);
  const saved=await readDocument(page);expect(saved.data.devices.find(item=>item.id===device('QF1').id)?.electrical?.phase).toBe('L2');
  for(const code of ['QF3','Q1','SPD1','FI1'])expect(saved.data.devices.find(item=>item.id===device(code).id)?.electrical?.phase).toBeUndefined();
  expect(saved.data.circuits[2].phase).toBe('L1');
});
