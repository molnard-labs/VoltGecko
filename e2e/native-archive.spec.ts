import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { encodeProject } from '../src/data/archive';
import type { BoardWire, Device, ProjectData, ProjectDocument, WiringEndpoint } from '../src/types';

const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQykAAAAASUVORK5CYII=', 'base64');
const terminal = (deviceId:string, side:'top'|'bottom', pole:number):WiringEndpoint => ({kind:'device',deviceId,side,pole});
const bus = (busId:string, slot:number):WiringEndpoint => ({kind:'bus',busId,terminal:slot});
const input = (infeedId:string, pole:number):WiringEndpoint => ({kind:'infeed',infeedId,pole});
const wire = (id:string, from:WiringEndpoint, to:WiringEndpoint, color='#7a4a1e'):BoardWire => ({id,from,to,color});

/** Current native project data only; no private plan or conversion metadata. */
function fixture():ProjectDocument {
  const device = (id:string, code:string, name:string, kind:Device['kind'], boardId:string, moduleWidth:number, electrical:NonNullable<Device['electrical']>):Device =>
    ({id,code,name,kind,boardId,moduleWidth,electrical,room:'',heightMm:0,model:'',notes:'',status:'planned',photoIds:[]});
  const devices = [
    device('rcd','FI-M','Four-pole RCD','rcd','main',4,{role:'rccb',poles:['L1','L2','L3','N'],currentA:40,residualCurrentMa:30,residualType:'A'}),
    device('neutral','X-N','Neutral <tag> & terminal','custom','main',1.5,{role:'terminal',poles:['N','N'],commonPoleGroups:[[0,1]],group:'main-terminals'}),
    device('breaker','F7','Shared protection','breaker','garden',1,{role:'mcb',poles:['L'],currentA:16,curve:'B',phase:'L1'}),
    device('earth','X-PE','Earth terminal','custom','garden',1.5,{role:'terminal',poles:['PE','PE'],commonPoleGroups:[[0,1]],group:'garden-terminals'}),
  ];
  devices[0].rating='4P 40 A / 30 mA'; devices[1].photoIds=['seed-photo']; devices[2].rating='B16'; devices[2].circuitId='lighting';
  const mainWires:BoardWire[] = [
    {...wire('neutral-wire',terminal('rcd','top',3),terminal('neutral','top',0),'#2d6fd3'),cable:{designation:'H07V-K',cores:1,crossSectionMm2:6,material:'Cu',lengthM:2,resistanceOhmPerKm:3.39}},
    wire('common-screw-bridge',terminal('neutral','top',0),terminal('neutral','bottom',1),'#2d6fd3'),
    {...wire('cross-cabinet',terminal('rcd','top',0),terminal('breaker','bottom',0)),points:[{x:25,y:12},{x:25,y:280}],label:'Main to garden',labelOffset:{x:5,y:8}},
    wire('parallel-edge',terminal('rcd','top',0),terminal('breaker','bottom',0)),
    wire('loop-return',terminal('breaker','top',0),terminal('rcd','bottom',0)),
    wire('earth-bus',terminal('earth','bottom',1),bus('main-pe',0),'#26833b'),
    ...['#7a4a1e','#1c1c1c','#8a8f95','#2d6fd3'].map((color,pole)=>wire(`incoming-${pole}`,input('grid',pole),terminal('rcd','bottom',pole),color)),
  ];
  const gardenWires:BoardWire[] = [
    wire('row-tap',terminal('breaker','bottom',0),bus('garden-phase',0)),
    wire('row-feed',terminal('rcd','top',0),bus('garden-phase',1)),
    wire('neutral-bus',terminal('neutral','bottom',1),bus('garden-n',0),'#2d6fd3'),
    {...wire('external-neutral',input('solar-neutral',0),bus('garden-n',2),'#2d6fd3'),cable:{designation:'Cu 1×4 mm²',cores:1,crossSectionMm2:4,material:'Cu'}},
    wire('earth-feed',input('earth-electrode',0),terminal('earth','top',1),'#26833b'),
  ];
  const data:ProjectData = {
    id:'native-wiring-project',name:'Native <panel> & integration',site:'Two cabinet QA',client:'Local QA',notes:'Native project with complete shared data.',devices,
    circuits:[
      {id:'lighting',code:'21',name:'Garden lighting',notes:'Garden lamp',color:'#d59a28',protectionDeviceId:'breaker',powerW:250,phase:'L1',loadType:'lamp',cable:'Cu 3×1,5 mm²',cableDetails:{designation:'Cu 3×1,5 mm²',cores:3,crossSectionMm2:1.5,material:'Cu',lengthM:12}},
      {id:'sockets',code:'22',name:'Garden sockets',notes:'Outdoor socket',color:'#376fd0',protectionDeviceId:'breaker',powerW:500,phase:'L1',loadType:'socket',cable:'Cu 3×2,5 mm²',cableDetails:{designation:'Cu 3×2,5 mm²',cores:3,crossSectionMm2:2.5,material:'Cu',lengthM:14}},
    ],
    sheets:[{id:'floor',name:'Shared floor plan',width:120,height:80,backgroundAssetId:'background',placements:[{deviceId:'neutral',x:15,y:20,rotation:0},{deviceId:'breaker',x:90,y:50,rotation:90}],routes:[{id:'floor-route',fromDeviceId:'neutral',toDeviceId:'breaker',kind:'power',circuitId:'lighting',points:[{x:15,y:20},{x:90,y:50}]}],annotations:[{id:'floor-note',text:'Native floor note',x:20,y:60}]}],
    boards:[
      {id:'main',name:'Main cabinet',rows:[{id:'main-row',name:'Main row',capacity:12,placements:[{deviceId:'rcd',start:0},{deviceId:'neutral',start:5.25}]}],connections:[],wiring:{demandFactor:0.75,wires:mainWires,buses:[
        {id:'main-n',name:'N main',conductor:'N',capacity:4,position:'bottom',terminalLabels:['Incoming N']},
        {id:'main-pe',name:'PE main',conductor:'PE',capacity:4,position:'bottom',terminalLabels:['Remote earth']},
      ],infeeds:[{id:'grid',name:'Incoming cable',kind:'supply',poles:['L1','L2','L3','N'],cable:{designation:'Cu 4×10 mm²',cores:4,crossSectionMm2:10,material:'Cu'}}]}},
      {id:'garden',name:'Garden cabinet',rows:[{id:'garden-row',name:'Garden row',capacity:12,placements:[{deviceId:'breaker',start:0},{deviceId:'earth',start:2.5}]}],connections:[],wiring:{demandFactor:0.75,wires:gardenWires,buses:[
        {id:'garden-n',name:'N garden',conductor:'N',capacity:4,position:'top',terminalLabels:['Protected N','','Solar N']},
        {id:'garden-pe',name:'PE garden',conductor:'PE',capacity:4,position:'top',terminalLabels:['Local earth']},
        {id:'garden-phase',name:'L1 phase bus',conductor:'L1',capacity:12,rowId:'garden-row',position:'bottom',terminalLabels:[]},
      ],infeeds:[{id:'solar-neutral',name:'Solar neutral',kind:'supply',poles:['N'],labelOffset:{x:4,y:9}},{id:'earth-electrode',name:'Earth electrode',kind:'earth',poles:['PE'],position:{x:450,y:240},labelOffset:{x:8,y:-4}}]}},
    ],
  };
  const updatedAt='2026-01-01T00:00:00.000Z';
  return {schemaVersion:1,data,updatedAt,assets:{
    'seed-photo':{id:'seed-photo',name:'Initial terminal photo.png',mime:'image/png',data:`data:image/png;base64,${photo.toString('base64')}`},
    background:{id:'background',name:'Shared floor.svg',mime:'image/svg+xml',data:`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#ffffff"/></svg>').toString('base64')}`},
  },revisions:[{id:'initial',createdAt:updatedAt,note:'Native terminal plan',data:structuredClone(data)}],headRevisionId:'initial'};
}

async function readDocument(page:Page,projectId?:string):Promise<ProjectDocument> {
  return page.evaluate(async requestedId=>{
    const id=requestedId??localStorage.getItem('planner.activeProject');if(!id)throw new Error('No active project');
    return new Promise<ProjectDocument>((resolve,reject)=>{
      const request=indexedDB.open('villamos-tervezo-local');request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{const db=request.result,get=db.transaction('projects','readonly').objectStore('projects').get(id);get.onerror=()=>{db.close();reject(get.error);};get.onsuccess=()=>{db.close();if(!get.result?.document)reject(new Error('No saved document'));else resolve(get.result.document);};};
    });
  },projectId);
}

async function openNativeProject(page:Page,document=fixture()) {
  await page.addInitScript(()=>Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true}));
  await page.goto('/');
  await page.locator('.start-actions').getByRole('button',{name:/^Projekt megnyitása/}).click();
  const selecting=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Projektfájl kiválasztása',exact:true}).click();
  await (await selecting).setFiles({name:'native-terminal-plan.vgecko',mimeType:'application/zip',buffer:Buffer.from(await (await encodeProject(document)).arrayBuffer())});
  await expect(page.locator('.project-switch strong')).toHaveText(document.data.name);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await page.locator('.view-tabs').getByRole('button',{name:'Elosztó',exact:true}).click();
}

async function download(page:Page,testInfo:TestInfo,button:string|RegExp,filename:string) {
  const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:button,exact:typeof button==='string'}).click();
  const result=await downloading,destination=testInfo.outputPath(filename);await result.saveAs(destination);
  return {result,destination};
}

test('opens a native archive and retains every terminal wire in all-board SVG, PNG, PDF, assets and history',async({page},testInfo)=>{
  test.setTimeout(120_000);
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const original=fixture();await openNativeProject(page,original);
  const imported=await readDocument(page),wires=imported.data.boards.flatMap(board=>board.wiring!.wires);
  expect(imported.data.boards).toHaveLength(2);expect(imported.data.devices).toHaveLength(4);expect(wires).toHaveLength(15);
  expect(imported).toEqual(original);
  expect(imported.data.boards.every(board=>board.connections?.length===0)).toBe(true);
  expect(imported.data.sheets).toEqual(original.data.sheets);
  const neutral=imported.data.devices.find(device=>device.code==='X-N')!;
  expect(neutral.moduleWidth).toBe(1.5);expect(neutral.electrical?.commonPoleGroups).toEqual([[0,1]]);
  expect(imported.data.boards[0].rows[0].placements.find(p=>p.deviceId===neutral.id)?.start).toBe(5.25);
  expect(imported.data.circuits.map(c=>[c.code,c.powerW])).toEqual([['21',250],['22',500]]);

  // A pre-existing feature still attaches photographs to the same shared device.
  await page.locator('.wiring-device-group').filter({hasText:'X-N'}).click();
  await page.locator('.photo-upload input').setInputFiles({name:'terminal-photo.png',mimeType:'image/png',buffer:photo});
  await expect(page.locator('.photo-grid img')).toHaveCount(2);
  await expect.poll(async()=>Object.keys((await readDocument(page)).assets).length).toBe(3);
  await page.getByRole('button',{name:'Kijelölés bezárása',exact:true}).click();
  await page.locator('.view-tabs').getByRole('button',{name:/Előzmények/}).click();
  await page.getByLabel('Verzió megjegyzése',{exact:true}).fill('QA: native terminal wiring and photo');
  await page.locator('.revision-compose').getByRole('button',{name:'Verzió mentése',exact:true}).click();
  await expect.poll(async()=>(await readDocument(page)).revisions.at(-1)?.note).toBe('QA: native terminal wiring and photo');

  await page.locator('.view-tabs').getByRole('button',{name:'Egyvonalas',exact:true}).click();
  await page.getByLabel('Egyvonalas rajz elosztója',{exact:true}).selectOption('all');
  const svg=page.locator('.single-line-svg svg');
  await expect(svg.locator('[data-device-id]')).toHaveCount(4);await expect(svg.locator('[data-connection-id]')).toHaveCount(15);
  const visibleIds=await svg.locator('[data-connection-id]').evaluateAll(elements=>elements.map(element=>element.getAttribute('data-connection-id')).sort());
  expect(visibleIds).toEqual(wires.map(wire=>wire.id).sort());
  for(const wire of wires)await expect(svg.locator(`[data-connection-id="${wire.id}"] path`)).not.toHaveAttribute('marker-end');
  await expect(svg).toContainText('Main cabinet');await expect(svg).toContainText('Garden cabinet');
  await expect(svg).toContainText('FI-M · felső 4 (N)');await expect(svg).toContainText('X-N · felső 1 (N)');
  await expect(svg).toContainText('X-N · alsó 2 (N)');await expect(svg).toContainText('Solar neutral');
  await expect(svg).toContainText('Garden lighting');await expect(svg).toContainText('Garden sockets');
  await expect(svg.locator('script,foreignObject')).toHaveCount(0);
  const vector=await download(page,testInfo,'SVG letöltése','all-boards.svg');
  expect(vector.result.suggestedFilename()).toMatch(/-single-line\.svg$/);
  const xml=await readFile(vector.destination,'utf8');
  expect(xml.match(/data-connection-id=/g)).toHaveLength(15);
  for(const wire of wires)expect(xml).toContain(`data-connection-id="${wire.id}"`);
  expect(xml).toContain('Neutral &lt;tag&gt; &amp; terminal');expect(xml).not.toMatch(/<script|<foreignObject/i);
  const raster=await download(page,testInfo,'PNG letöltése','all-boards.png');
  expect(raster.result.suggestedFilename()).toMatch(/\.png$/);
  const png=await readFile(raster.destination);expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
  expect(png.readUInt32BE(16)).toBeGreaterThan(100);expect(png.readUInt32BE(20)).toBeGreaterThan(100);
  await page.screenshot({path:testInfo.outputPath('all-boards-browser.png'),fullPage:true});

  await page.getByRole('button',{name:'Mentés és export',exact:true}).click();
  const pdf=await download(page,testInfo,/Részletes szakmai PDF/,'terminal-wiring.pdf');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  const pdfBytes=await readFile(pdf.destination);expect(pdfBytes.subarray(0,5).toString()).toBe('%PDF-');
  const loadingPdf=getDocument({data:new Uint8Array(pdfBytes),useSystemFonts:true});
  const pdfDocument=await loadingPdf.promise;
  const pdfPages:string[]=[];
  for(let number=1;number<=pdfDocument.numPages;number++) {
    const content=await (await pdfDocument.getPage(number)).getTextContent();
    pdfPages.push(content.items.map(item=>'str' in item?item.str:'').join(' '));
  }
  expect(pdfDocument.numPages).toBeGreaterThan(5);await loadingPdf.destroy();
  const pdfText=pdfPages.join('\n'),compactPdf=pdfText.replace(/\s/g,'');
  expect(pdfText).toContain('Main cabinet · kapocshuzalozás');expect(pdfText).toContain('Garden cabinet · kapocshuzalozás');
  expect(pdfText).toContain('FI-M · felső 4 (N)');expect(pdfText).toContain('X-N · alsó 2 (N)');
  expect(pdfText).toContain('Solar neutral');expect(pdfText).toContain('H07V-K');
  for(const wire of wires)expect(compactPdf,`wire ${wire.id} must have a terminal-table row`).toContain(wire.id);

  await page.getByRole('button',{name:'Mentés és export',exact:true}).click();
  const archive=await download(page,testInfo,/Projektfájl mentése/,'terminal-wiring.vgecko');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  const exported=await readDocument(page);
  expect(exported.revisions.some(revision=>revision.note==='QA: native terminal wiring and photo')).toBe(true);
  await svg.locator(`[data-device-id="${neutral.id}"]`).click();
  await page.getByLabel('Eszköz megjegyzése',{exact:true}).fill('Keep this local edit after archive import.');
  await expect.poll(async()=>(await readDocument(page)).data.devices.find(device=>device.id===neutral.id)?.notes).toBe('Keep this local edit after archive import.');
  await page.locator('input[accept*=".vgecko"]').setInputFiles(archive.destination);
  await expect(page.locator('.project-switch strong')).toContainText('importált másolat');
  const restored=await readDocument(page);expect(restored.data.id).not.toBe(exported.data.id);
  expect(restored.data.boards).toEqual(exported.data.boards);expect(restored.data.devices).toEqual(exported.data.devices);
  expect(restored.data.circuits).toEqual(exported.data.circuits);expect(restored.assets).toEqual(exported.assets);
  expect(restored.revisions.map(revision=>({...revision,data:{...revision.data,id:exported.data.id}}))).toEqual(exported.revisions);
  expect((await readDocument(page,exported.data.id)).data.devices.find(device=>device.id===neutral.id)?.notes).toBe('Keep this local edit after archive import.');
  await page.locator('.view-tabs').getByRole('button',{name:'Egyvonalas',exact:true}).click();
  await page.getByLabel('Egyvonalas rajz elosztója',{exact:true}).selectOption('all');
  await expect(page.locator('.single-line-svg [data-connection-id]')).toHaveCount(15);
  expect(errors).toEqual([]);
});

test('rejects a native archive with a missing terminal device without replacing the existing project',async({page})=>{
  const document=fixture();await openNativeProject(page,document);const before=await readDocument(page);
  const files=unzipSync(new Uint8Array(await (await encodeProject(document)).arrayBuffer()));
  const manifest=JSON.parse(strFromU8(files['project.json']));
  manifest.data.boards[0].wiring.wires[0].from.deviceId='missing-device';
  files['project.json']=strToU8(JSON.stringify(manifest));
  await page.locator('input[accept*=".vgecko"]').setInputFiles({name:'broken-native.vgecko',mimeType:'application/zip',buffer:Buffer.from(zipSync(files))});
  await expect(page.locator('.toast')).toContainText('hiányzó hivatkozás');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect((await readDocument(page)).data).toEqual(before.data);
  expect((await readDocument(page)).revisions).toEqual(before.revisions);
});
