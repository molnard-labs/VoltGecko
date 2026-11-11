import { afterEach, describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject } from '../data/project';
import { setLanguage } from '../i18n';
import { buildSingleLineSvg, buildProjectSingleLineSvg, circuitCableLabel } from './singleLine';
import { diagramTiles } from './diagramPages';
import type { Circuit, Device } from '../types';

afterEach(() => setLanguage('hu'));
function fixture() {
  const data = createProject('Graph test').data;
  const devices: Device[] = [];
  for (const kind of ['main', 'rcd', 'breaker', 'breaker', 'blank'] as const) devices.push(makeDevice(kind, devices));
  data.devices = devices;
  const board = data.boards[0];
  board.rows[0].placements = devices.map((device, index) => ({ deviceId: device.id, start: index * 2 }));
  board.supplyLabel = '3 × 400 / 230 V';
  board.connections = [
    { id: 'supply', toDeviceId: devices[0].id },
    { id: 'main-rcd', fromDeviceId: devices[0].id, toDeviceId: devices[1].id },
    { id: 'branch-one', fromDeviceId: devices[1].id, toDeviceId: devices[2].id },
    { id: 'branch-two', fromDeviceId: devices[1].id, toDeviceId: devices[3].id },
  ];
  return { data, board, devices };
}

describe('single-line SVG', () => {
  it('keeps the circuit schedule rows and title block readable across PDF page breaks', () => {
    const { data, board, devices } = fixture();
    data.circuits = Array.from({length:8},(_,i)=>({id:`c-${i}`,code:`C${i}`,name:`Circuit ${i}`,notes:'',color:'#287c68',protectionDeviceId:devices[2].id}));
    const drawing = buildSingleLineSvg(data,board);
    const regions = drawing.blocks.slice(-(4 * 9 + 2));
    expect(regions).toHaveLength(38);
    const pages = diagramTiles(drawing, 700, 350);
    for (const region of regions) {
      expect(pages.some(page => page.y <= region.y && page.y + page.height >= region.y + region.height), JSON.stringify({region,pages:pages.filter(page=>page.column===1)})).toBe(true);
    }
    const xPages = pages.filter(page=>page.row === 1);
    expect(xPages.at(-1)!.x + xPages.at(-1)!.width).toBe(drawing.width);
  });
  it('distinguishes each detailed wire and the incomplete legacy feed without assuming they are equivalent', () => {
    const { data, board, devices } = fixture();
    devices[0].electrical = { poles: ['L'] }; devices[1].electrical = { poles: ['L'] };
    board.wiring = { buses: [], infeeds: [], wires: [
      { id: 'physical', from: { kind:'device', deviceId:devices[1].id, side:'top', pole:0 }, to: { kind:'device', deviceId:devices[0].id, side:'bottom', pole:0 } },
      { id: 'second-wire', from: { kind:'device', deviceId:devices[0].id, side:'bottom', pole:0 }, to: { kind:'device', deviceId:devices[1].id, side:'top', pole:0 } },
    ] };
    const snapshot = structuredClone(data), svg = buildSingleLineSvg(data,board).svg;
    expect(svg).toContain('data-connection-id="main-rcd"');
    expect(svg).toContain('data-connection-id="physical"');
    expect(svg).toContain('data-connection-id="second-wire"');
    expect(svg).toContain('data-connection-id="branch-one"');
    expect(svg).toContain('Részletezetlen kapcsolat');
    expect(svg).toContain('A pontos kapcsok nincsenek megadva.');
    expect(data).toEqual(snapshot);
  });
  it('preserves an incomplete virtual supply when supply and earth conductors are added', () => {
    const { data, board, devices } = fixture();
    devices[0].electrical = { poles: ['L'] };
    const target = { kind:'device' as const, deviceId:devices[0].id, side:'top' as const, pole:0 };
    board.wiring = { buses: [], infeeds: [
      { id:'grid', name:'Grid', kind:'supply', poles:['L'] },
      { id:'earth', name:'Earth', kind:'earth', poles:['PE'] },
    ], wires: [{ id:'earth-wire', from:{kind:'infeed',infeedId:'earth',pole:0}, to:target }] };
    expect(buildSingleLineSvg(data,board).svg).toContain('data-connection-id="supply"');
    board.wiring.wires.push({ id:'grid-wire', from:target, to:{kind:'infeed',infeedId:'grid',pole:0} });
    const svg=buildSingleLineSvg(data,board).svg;
    expect(svg).toContain('data-connection-id="supply"');
    expect(svg).toContain('data-connection-id="grid-wire"');
    expect(svg).toContain('data-connection-id="earth-wire"');
  });
  it('retains wires with custom and green-yellow colors without mutating stored data', () => {
    const { data, board, devices } = fixture();
    board.connections = [];
    devices[0].electrical = { poles: ['PE'] };
    devices[1].electrical = { poles: ['PE'] };
    const from = { kind: 'device' as const, deviceId: devices[0].id, side: 'bottom' as const, pole: 0 };
    const to = { kind: 'device' as const, deviceId: devices[1].id, side: 'top' as const, pole: 0 };
    board.wiring = { buses: [], infeeds: [], wires: [
      { id: 'striped-earth', from, to, color: '#2f9e44', colorPattern: 'green-yellow' },
      { id: 'custom-green', from, to, color: '#2f9e44' }
    ] };
    const snapshot=structuredClone(data);
    const drawing = buildSingleLineSvg(data, board).svg;
    const striped = drawing.match(/<g data-connection-id="striped-earth"[\s\S]*?<\/g>/)![0];
    const solid = drawing.match(/<g data-connection-id="custom-green"[\s\S]*?<\/g>/)![0];
    expect(striped).toContain('Vezeték');
    expect(solid).toContain('Vezeték');
    expect(data).toEqual(snapshot);
  });
  it('retains manual circuit cable descriptions when only structured length is added',()=>{
    expect(circuitCableLabel({id:'c',code:'C',name:'Load',notes:'',color:'#123456',cable:'Existing NYM-J 3×2.5',cableDetails:{lengthM:10}})).toBe('Existing NYM-J 3×2.5 · 10 m');
  });
  it('distinguishes the selected cable section from a conflicting preserved description',()=>{
    const circuit={id:'c',code:'C',name:'Load',notes:'',color:'#123456',cable:'H07V-U 3×2,5 mm²',cableDetails:{crossSectionMm2:1.5,material:'Cu' as const}};
    expect(circuitCableLabel(circuit)).toBe('Beállított kábeladatok: Cu · 1.5 mm² · Kábelleírás: H07V-U 3×2,5 mm²');
    expect(circuit.cable).toBe('H07V-U 3×2,5 mm²');
  });
  it('reports declared conductor selection separately from existing cable core data',()=>{
    const circuit={id:'c',code:'C',name:'Load',notes:'',color:'#123456',conductors:['L','N'] as ('L'|'N')[],cableDetails:{cores:3,crossSectionMm2:2.5}};
    expect(circuitCableLabel(circuit)).toBe('3×2.5 mm² · Kiválasztott vezetők: L / N (2)');
    expect(circuit.cableDetails.cores).toBe(3);
  });
  it('makes a saved conductor selection conflicting with terminal data explicit',()=>{
    const circuit:Circuit={id:'c',code:'C',name:'Load',notes:'',color:'#123456',conductors:['L'],boardConnections:[{boardId:'b',terminals:[{conductor:'N',endpoint:{kind:'bus',busId:'n',terminal:0}}]}]};
    expect(circuitCableLabel(circuit)).toContain('Kiválasztott vezetők: L (1) · Kapocsadat a kijelölésen kívül: N');
  });
  it('draws each canonical circuit once with its actual board terminals independently of floor routes', () => {
    const {data,board,devices} = fixture();
    board.connections = [];
    devices[2].electrical = {poles:['L','N']};
    board.wiring = {wires:[],infeeds:[],buses:[{id:'neutral',name:'N sín',conductor:'N',capacity:2,position:'bottom',terminalLabels:['','']},
      {id:'earth',name:'PE sín',conductor:'PE',capacity:2,position:'bottom',terminalLabels:['','']}]};
    data.circuits = [{id:'c',code:'C1',name:'Konyha',color:'#224466',notes:'',powerW:500,boardConnections:[{
      boardId:board.id,terminals:[
        {conductor:'L',endpoint:{kind:'device',deviceId:devices[2].id,side:'bottom',pole:0}},
        {conductor:'N',endpoint:{kind:'bus',busId:'neutral',terminal:1}},
        {conductor:'PE',endpoint:{kind:'bus',busId:'earth',terminal:0}},
      ],
    }]}];
    const first = buildSingleLineSvg(data,board).svg;
    expect(first.match(/data-circuit-id="c"/g)).toHaveLength(3);
    expect(first).toContain(`data-connection-id="circuit:c:${board.id}:L"`);
    expect(first).toContain(`data-connection-id="circuit:c:${board.id}:N"`);
    expect(first).toContain(`data-connection-id="circuit:c:${board.id}:PE"`);
    expect(first).toContain('N sín · 2 (N)');
    const ports = [...first.matchAll(/data-circuit-port="(L|N|PE)" data-board-id="[^"]+"/g)].map(item=>item[1]);
    expect(ports).toEqual(['L','N','PE']);
    data.sheets[0].routes = [{id:'drawing',fromDeviceId:devices[2].id,toDeviceId:devices[3].id,kind:'power',points:[]}];
    expect(buildSingleLineSvg(data,board).svg).toBe(first);
    expect(buildProjectSingleLineSvg(data).svg.match(/data-circuit-id="c"/g)).toHaveLength(3);
  });
  it('does not draw a manual protective assignment as an electrical connection', () => {
    const {data,board,devices} = fixture();
    board.connections = [];
    devices[2].electrical = {poles:['L','N']}; devices[3].electrical = {poles:['L']};
    board.wiring = {wires:[],infeeds:[],buses:[]};
    data.circuits = [{id:'c',code:'C1',name:'Circuit',color:'#224466',notes:'',protectionDeviceId:devices[2].id,boardConnections:[{
      boardId:board.id,terminals:[{conductor:'N',endpoint:{kind:'device',deviceId:devices[2].id,side:'bottom',pole:1}}],
    }]}];
    const connection = data.circuits[0].boardConnections![0];
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-connection-id="protection:c"');
    expect(buildSingleLineSvg(data,board).svg).toContain('Nincs fázisbekötés');
    connection.terminals.push({conductor:'L',endpoint:{kind:'device',deviceId:devices[3].id,side:'bottom',pole:0}});
    const wired = buildSingleLineSvg(data,board).svg;
    expect(wired).not.toContain('data-connection-id="protection:c"');
    expect(wired).toContain(`data-connection-id="circuit:c:${board.id}:L"`);
    expect(wired).toContain(`C1 · L ↔ ${devices[3].code} · alsó 1 (L)`);
    connection.terminals[1].endpoint = {kind:'device',deviceId:devices[2].id,side:'bottom',pole:0};
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-connection-id="protection:c"');
  });
  it('preserves every pole wire, same-device bridge, bus, infeed and cross-board endpoint without inventing direction',()=>{
    const {data,board,devices}=fixture();board.connections=[];
    devices[0].electrical={poles:['L1','L2','L3','N']};devices[1].electrical={poles:['N','PE']};
    const other={id:'other',name:'Garden',rows:[],connections:[],wiring:{buses:[{id:'pe',name:'PE <bus>',conductor:'PE' as const,capacity:6,terminalLabels:[],position:'top' as const}],infeeds:[],wires:[]}};
    data.boards.push(other);
    board.wiring={buses:[],infeeds:[{id:'grid',name:'Grid & supply',kind:'supply',poles:['L1','N'],currentA:16}],wires:[
      {id:'feed-phase',from:{kind:'infeed',infeedId:'grid',pole:0},to:{kind:'device',deviceId:devices[0].id,side:'bottom',pole:0},cable:{designation:'H07V-K',cores:1,crossSectionMm2:6,lengthM:3}},
      {id:'neutral-wire',from:{kind:'infeed',infeedId:'grid',pole:1},to:{kind:'device',deviceId:devices[0].id,side:'bottom',pole:3}},
      {id:'same-device',from:{kind:'device',deviceId:devices[1].id,side:'top',pole:0},to:{kind:'device',deviceId:devices[1].id,side:'top',pole:1}},
      {id:'cross-board',from:{kind:'device',deviceId:devices[1].id,side:'bottom',pole:1},to:{kind:'bus',busId:'pe',terminal:2}},
    ]};
    const before=structuredClone(data),drawing=buildSingleLineSvg(data,board);
    for(const wire of board.wiring.wires)expect(drawing.svg).toContain(`data-connection-id="${wire.id}"`);
    expect(drawing.svg.match(/data-connection-id=/g)).toHaveLength(4);
    expect(drawing.svg).toContain('PE &lt;bus&gt;');expect(drawing.svg).toContain('Grid &amp; supply');expect(drawing.svg).toContain('16 A');expect(drawing.svg).toContain('H07V-K');expect(drawing.svg).toContain('6 mm²');
    expect(drawing.svg).toContain('alsó 4 (N)');expect(drawing.svg).not.toContain('marker-end="url(#single-line-arrow)"');
    const combined=buildProjectSingleLineSvg(data);expect(combined.svg.match(/data-connection-id=/g)).toHaveLength(4);expect(combined.svg).toContain('Garden');
    expect(data).toEqual(before);
  });
  it('shows explicit supply, all graph edges, ratings, manufacturer references and circuit data', () => {
    const { data, board, devices } = fixture();
    devices[2].model = 'Schneider EZ9F57116';
    data.circuits.push({ id: 'circuit', code: 'ÁK1', name: 'Dugaljak', color: '#287c68', notes: '', protectionDeviceId: devices[2].id, cable: 'NYM-J 3 × 2,5 mm²', powerW: 2300 });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg.match(/data-connection-id=/g)).toHaveLength(4);
    expect(result.svg).not.toContain('data-connection-id="protection:circuit"');
    expect(result.svg.match(/data-device-id=/g)).toHaveLength(4);
    for (const value of ['3 × 400 / 230 V', 'Schneider EZ9F57116', 'NYM-J 3 × 2,5 mm²', '2300 W', 'B16', 'ÁK1 · Dugaljak']) expect(result.svg).toContain(value);
    expect(result.svg).not.toContain(`data-device-id="${devices[4].id}"`);
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
  });
  it('does not invent wire links for disconnected DIN devices', () => {
    const { data, board } = fixture();
    board.connections = [];
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).not.toContain('data-connection-id=');
    expect(result.svg).toContain('Nincs megadott kapcsolat');
    expect(result.svg).toContain('Nincs bekötve');
    expect(result.svg).not.toContain('data-device-id="supply"');
  });
  it('retains cycles, self-links, multiple feeds and repeated links instead of producing a spanning tree', () => {
    const { data, board, devices } = fixture();
    board.connections!.push(
      { id: 'cycle', fromDeviceId: devices[2].id, toDeviceId: devices[0].id },
      { id: 'parallel-feed', fromDeviceId: devices[0].id, toDeviceId: devices[2].id },
      { id: 'self', fromDeviceId: devices[2].id, toDeviceId: devices[2].id },
      { id: 'duplicate', fromDeviceId: devices[1].id, toDeviceId: devices[2].id },
    );
    const result = buildSingleLineSvg(data, board);
    expect(result.svg.match(/data-connection-id=/g)).toHaveLength(8);
    for (const connection of board.connections!) expect(result.svg).toContain(`data-connection-id="${connection.id}"`);
    expect(result.svg).not.toMatch(/NaN|Infinity/);
    // These legacy links lack terminal identities: retain them explicitly as
    // incomplete records, never draw them as verified electrical paths.
    for (const connection of board.connections!) {
      const record=result.svg.match(new RegExp(`<g data-connection-id="${connection.id}"[\\s\\S]*?<\\/g>`))![0];
      expect(record).toContain('Részletezetlen kapcsolat');
      expect(record).toContain('A pontos kapcsok nincsenek megadva.');
    }
  });
  it('includes explicitly connected unplaced meters and missing endpoints without discarding the connection', () => {
    const { data, board, devices } = fixture();
    const meter = makeDevice('custom', devices); meter.name = 'Fogyasztásmérő';
    data.devices.push(meter);
    board.connections!.push({ id: 'meter-feed', fromDeviceId: meter.id, toDeviceId: devices[0].id }, { id: 'missing', fromDeviceId: devices[2].id, toDeviceId: 'deleted-meter' });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).toContain(`data-device-id="${meter.id}"`);
    expect(result.svg).toContain('Fogyasztásmérő');
    expect(result.svg.toLowerCase()).toContain('hiányzó készülék');
    expect(result.svg).toContain('deleted-meter');
    expect(result.svg.match(/data-connection-id=/g)).toHaveLength(6);
  });
  it('includes board-assigned DIN devices without inferring a circuit connection from a stale assignment', () => {
    const { data, board, devices } = fixture();
    const unplaced = makeDevice('rcbo', devices); unplaced.boardId = board.id;
    data.devices.push(unplaced);
    devices[1].circuitId = 'shared';
    data.circuits.push({ id: 'shared', code: 'C1', name: 'Explicit protection', color: '#287c68', notes: '', protectionDeviceId: unplaced.id, cable: '5 × 2,5 mm²', powerW: 9000 });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).toContain(`data-device-id="${unplaced.id}"`);
    expect(result.svg).not.toContain('data-circuit-id="shared"');
    expect(result.svg).not.toContain('data-connection-id="protection:shared"');
    expect(result.svg).toContain('Nincs fázisbekötés');
    expect(result.svg).toContain('5 × 2,5 mm²');
  });
  it('uses a circuit-linked device for legacy circuit data with no protective assignment', () => {
    const { data, board, devices } = fixture();
    devices[1].circuitId = 'legacy';
    data.circuits.push({ id: 'legacy', code: 'C2', name: 'Contactor load', color: '#287c68', notes: '', cable: '3 × 1,5 mm²', powerW: 0 });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).toContain('C2 · Contactor load');
    expect(result.svg).toContain('3 × 1,5 mm² · 0 W');
  });
  it('escapes user-controlled XML and rejects injected CSS colors with no external fonts, images or HTML', () => {
    const { data, board, devices } = fixture();
    board.name = '<script>alert("board")</script>';
    board.supplyLabel = '<image href="https://bad.invalid/x" onload="bad()"/>';
    devices[0].name = '<foreignObject onload="bad()">&bad';
    devices[0].id = 'device" onclick="bad()';
    devices[0].electrical = {poles:['L'],role:'mcb" onload="bad()' as NonNullable<Device['electrical']>['role']};
    board.rows[0].placements[0].deviceId = devices[0].id;
    board.connections![0].toDeviceId = devices[0].id;
    board.connections![1].fromDeviceId = devices[0].id;
    board.connections![0].id = '"><script>bad()</script>';
    data.circuits.push({ id: 'bad-circuit', code: 'x', name: 'unsafe', notes: '', color: 'red" onclick="bad()', protectionDeviceId: devices[0].id });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).not.toContain('<script>');
    expect(result.svg).not.toContain('<image');
    expect(result.svg).not.toContain('<foreignObject');
    expect(result.svg).not.toContain('" onclick="');
    expect(result.svg).not.toContain('@font-face');
    expect(result.svg).toContain('&lt;script&gt;');
    expect(result.svg).toContain('device&quot; onclick=&quot;bad()');
  });
  it('renders empty boards and a long cyclic graph without recursion or invalid dimensions', () => {
    const { data, board } = fixture();
    board.rows = [];
    board.connections = [];
    expect(buildSingleLineSvg(data, board).svg).toContain('Nincs készülék az elosztóban');
    data.devices = Array.from({ length: 1200 }, (_, index) => ({ ...makeDevice('breaker', []), id: `d-${index}`, code: `QF${index}` }));
    board.connections = data.devices.map((device, index) => ({ id: `edge-${index}`, fromDeviceId: device.id, toDeviceId: data.devices[(index + 1) % data.devices.length].id }));
    const result = buildSingleLineSvg(data, board);
    expect(result.svg.match(/data-connection-id=/g)).toHaveLength(1200);
    for (const device of data.devices) expect(result.svg).toContain(`data-device-id="${device.id}"`);
    expect(result.svg).not.toMatch(/NaN|Infinity/);
    expect(result.width).toBeLessThan(2500);
    expect(Number.isFinite(result.height)).toBe(true);
    expect(result.height).toBeLessThan(150_000);
  });
  it('localizes exported labels while leaving user names intact', () => {
    const { data, board } = fixture();
    board.connections = [];
    board.name = 'Saját szekrény';
    setLanguage('en');
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).toContain('Saját szekrény');
    expect(result.svg).toContain('specified wires and previous, unspecified connections');
    expect(result.svg).not.toContain('with direction arrows');
    expect(result.svg).toContain('No connection specified');
    expect(result.svg).toContain('Single-line diagram');
    expect(result.svg).toContain('Phase connection');
    expect(result.svg).not.toContain('Nincs megadva a bemenet');
  });
  it('draws separate FI phase, neutral and PE networks and marks incompatible links', () => {
    const {data,board,devices}=fixture(); board.connections=[];
    devices[1].electrical={role:'rccb',poles:['L','N'],physicalPoleOrder:[1,0]};
    board.wiring={infeeds:[{id:'grid',name:'Hálózat',kind:'supply',poles:['L','N','PE']}],
      buses:[{id:'pe',name:'PE sín',conductor:'PE',capacity:2,terminalLabels:[],position:'bottom'}],
      wires:[
        {id:'phase',from:{kind:'infeed',infeedId:'grid',pole:0},to:{kind:'device',deviceId:devices[1].id,side:'top',pole:0}},
        {id:'neutral',from:{kind:'infeed',infeedId:'grid',pole:1},to:{kind:'device',deviceId:devices[1].id,side:'top',pole:1}},
        {id:'earth',from:{kind:'infeed',infeedId:'grid',pole:2},to:{kind:'bus',busId:'pe',terminal:0}},
        {id:'wrong',from:{kind:'infeed',infeedId:'grid',pole:0},to:{kind:'device',deviceId:devices[1].id,side:'top',pole:1}},
      ]};
    data.circuits=[{id:'c',code:'C1',name:'Kör',color:'#123456',notes:'',boardConnections:[{boardId:board.id,terminals:[
      {conductor:'L',endpoint:{kind:'device',deviceId:devices[1].id,side:'bottom',pole:0}},
      {conductor:'N',endpoint:{kind:'device',deviceId:devices[1].id,side:'bottom',pole:1}},
      {conductor:'PE',endpoint:{kind:'bus',busId:'pe',terminal:1}},
    ]}]}];
    const drawing=buildSingleLineSvg(data,board),svg=drawing.svg;
    for(const section of ['Fázisvezetők','Nullavezető (N)','Védővezető (PE)'])expect(svg).toContain(section);
    for(const conductor of ['L','N','PE'])expect(svg).toContain(`data-circuit-port="${conductor}"`);
    const bad=svg.match(/<g data-connection-id="wrong"[\s\S]*?<\/g>/)![0];
    expect(bad).toContain('fill="#fff8f5"');
    expect(svg).toContain('Hibás vezetőkapcsolat');
    expect(svg).toContain('felső 2 (L)');
    expect(svg).toContain('felső 1 (N)');
    expect(new Set(drawing.netSegments.map(segment=>segment.net)).size).toBeGreaterThanOrEqual(3);
    expect(drawing.netSegments.some(segment=>segment.x1===segment.x2 && segment.y2>segment.y1)).toBe(true);
  });
  it('does not treat unverified pole definitions as conducting device paths',()=>{
    const {data,board,devices}=fixture(); board.connections=[];
    delete devices[2].electrical;
    board.wiring={infeeds:[],buses:[],wires:[{id:'w',from:{kind:'device',deviceId:devices[2].id,side:'top',pole:0},to:{kind:'device',deviceId:devices[3].id,side:'top',pole:0}}]};
    const svg=buildSingleLineSvg(data,board).svg;
    expect(svg).toContain(`data-connection-id="uncertain-pole:${devices[2].id}:0"`);
    expect(svg).toContain('Pólusadat nincs megerősítve');
    expect(svg).not.toContain(`data-device-id="${devices[2].id}" data-pole=`);
  });
  it('preserves a genuine device-pole cycle with paired references and exact terminals',()=>{
    const {data,board,devices}=fixture();board.connections=[];
    for(const d of devices.slice(2,4))d.electrical={role:'mcb',poles:['L']};
    board.wiring={infeeds:[],buses:[],wires:[
      {id:'top',from:{kind:'device',deviceId:devices[2].id,side:'top',pole:0},to:{kind:'device',deviceId:devices[3].id,side:'top',pole:0}},
      {id:'bottom',from:{kind:'device',deviceId:devices[2].id,side:'bottom',pole:0},to:{kind:'device',deviceId:devices[3].id,side:'bottom',pole:0}},
    ]};
    const svg=buildSingleLineSvg(data,board).svg;
    expect(svg).toContain('data-connection-id="top"');
    expect(svg).toContain('data-connection-id="bottom"');
    expect(svg).toMatch(/data-connection-id="pole:/);
    expect(svg).toMatch(/Hurok phase-1/g);
    expect(svg).toContain('felső 1 (L)');
    expect(svg).toContain('alsó 1 (L)');
  });
  it('refers to a remote board continuation without inventing an open end',()=>{
    const {data,board,devices}=fixture(); board.connections=[];
    devices[2].electrical={role:'mcb',poles:['L']};
    const remote=makeDevice('breaker',devices);remote.id='remote';remote.code='QF-remote';remote.electrical={role:'mcb',poles:['L']};data.devices.push(remote);
    const other={id:'other',name:'Másik elosztó',rows:[{id:'r',name:'Sor',capacity:4,placements:[{deviceId:remote.id,start:0}]}],connections:[],wiring:{buses:[],infeeds:[{id:'remote-grid',name:'Távoli hálózat',kind:'supply' as const,poles:['L' as const]}],wires:[{id:'remote-feed',from:{kind:'infeed' as const,infeedId:'remote-grid',pole:0},to:{kind:'device' as const,deviceId:remote.id,side:'top' as const,pole:0}}]}};
    data.boards.push(other);
    board.wiring={infeeds:[],buses:[],wires:[{id:'cross',from:{kind:'device',deviceId:remote.id,side:'bottom',pole:0},to:{kind:'device',deviceId:devices[2].id,side:'top',pole:0}}]};
    const svg=buildSingleLineSvg(data,board).svg;
    const remoteGroup=svg.match(/<g data-device-id="remote"[\s\S]*?<\/g>/)![0];
    expect(remoteGroup).toContain('Másik elosztó');
    expect(remoteGroup).toContain('Távoli elosztó');
    expect(remoteGroup).not.toContain('Szabad, bekötetlen vég');
    expect(buildProjectSingleLineSvg(data).svg).toContain('data-connection-id="remote-feed"');
  });
  it('keeps a typical eight-circuit L/N/PE board in the graphical view',()=>{
    const {data,board}=fixture();board.connections=[];
    const breakers:Device[]=[];
    for(let i=0;i<8;i++){const d=makeDevice('breaker',breakers);d.electrical={role:'mcb',poles:['L']};breakers.push(d);}
    data.devices=breakers;board.rows[0].placements=breakers.map((d,i)=>({deviceId:d.id,start:i}));
    board.wiring={infeeds:[{id:'source',name:'Hálózat',kind:'supply',poles:['L','N','PE']}],buses:[
      {id:'n',name:'N sín',conductor:'N',capacity:8,position:'bottom',terminalLabels:[]},
      {id:'pe',name:'PE sín',conductor:'PE',capacity:8,position:'bottom',terminalLabels:[]}],wires:[]};
    for(let i=0;i<8;i++)board.wiring.wires.push({id:`w${i}`,from:{kind:'infeed',infeedId:'source',pole:0},to:{kind:'device',deviceId:breakers[i].id,side:'top',pole:0}});
    for(const [pole,id] of [[1,'n'],[2,'pe']] as const)board.wiring.wires.push({id:`w${id}`,from:{kind:'infeed',infeedId:'source',pole},to:{kind:'bus',busId:id,terminal:0}});
    data.circuits=breakers.map((d,i)=>({id:`c${i}`,code:`C${i}`,name:`Kör ${i}`,notes:'',color:'#123456',boardConnections:[{boardId:board.id,terminals:[
      {conductor:'L',endpoint:{kind:'device',deviceId:d.id,side:'bottom',pole:0}},
      {conductor:'N',endpoint:{kind:'bus',busId:'n',terminal:i}},
      {conductor:'PE',endpoint:{kind:'bus',busId:'pe',terminal:i}},
    ]}]}));
    const drawing=buildSingleLineSvg(data,board);
    expect(drawing.svg).not.toContain('A nagy hálózat pontos kapcsolatai');
    expect(drawing.svg.match(/data-circuit-port=/g)).toHaveLength(24);
    for(const wire of board.wiring.wires)expect(drawing.svg).toContain(`data-connection-id="${wire.id}"`);
  });
  it('shows the seven branch and eight neutral layout with long circuit names even when poles need review',()=>{
    const {data,board}=fixture();board.connections=[];
    const fi=makeDevice('rcd',[]);fi.electrical={role:'rccb',poles:['N','L']};
    const breakers:Device[]=[];
    for(let i=0;i<7;i++)breakers.push(makeDevice('breaker',breakers));
    data.devices=[fi,...breakers];
    board.rows[0].placements=data.devices.map((device,i)=>({deviceId:device.id,start:i}));
    board.wiring={infeeds:[{id:'source',name:'Hálózat',kind:'supply',poles:['L','N','PE']}],buses:[
      {id:'n',name:'N sín',conductor:'N',capacity:8,position:'bottom',terminalLabels:[]},
      {id:'pe',name:'PE sín',conductor:'PE',capacity:8,position:'bottom',terminalLabels:[]}],wires:[
      {id:'inL',from:{kind:'infeed',infeedId:'source',pole:0},to:{kind:'device',deviceId:fi.id,side:'top',pole:1}},
      {id:'inN',from:{kind:'infeed',infeedId:'source',pole:1},to:{kind:'device',deviceId:fi.id,side:'top',pole:0}},
      {id:'outN',from:{kind:'device',deviceId:fi.id,side:'bottom',pole:0},to:{kind:'bus',busId:'n',terminal:0}},
      {id:'inPE',from:{kind:'infeed',infeedId:'source',pole:2},to:{kind:'bus',busId:'pe',terminal:0}},
    ]};
    for(let i=0;i<7;i++)board.wiring.wires.push({id:`w${i}`,from:{kind:'device',deviceId:fi.id,side:'bottom',pole:1},to:{kind:'device',deviceId:breakers[i].id,side:'bottom',pole:0}});
    data.circuits=Array.from({length:8},(_,i)=>({id:`c${i}`,code:`ÁK${i+1}`,name:`Hosszú helyiségmegnevezés és további megjegyzés ${i}`,notes:'',color:'#123456',boardConnections:[{boardId:board.id,terminals:[
      {conductor:'N' as const,endpoint:{kind:'bus' as const,busId:'n',terminal:i}},
      ...(i<7?[{conductor:'L' as const,endpoint:{kind:'device' as const,deviceId:breakers[i].id,side:'top' as const,pole:0}}]:[]),
    ]}]}));
    const drawing=buildSingleLineSvg(data,board);
    expect(drawing.width).toBeLessThanOrEqual(3200);
    expect(drawing.svg).not.toContain('A hálózat túl nagy vagy másik elosztón keresztül folytatódik');
    expect(drawing.svg.match(/data-circuit-port="L"/g)).toHaveLength(7);
    expect(drawing.svg.match(/data-circuit-port="N"/g)).toHaveLength(8);
    expect(drawing.svg).toContain('ÁK8: fáziskapocs nincs megadva az elosztóterven.');
    expect(drawing.svg).toContain('ÁK1, ÁK2, ÁK3, ÁK4, ÁK5, ÁK6, ÁK7, ÁK8: PE-kapocs nincs megadva');
    for(const circuit of data.circuits)expect(drawing.svg).toContain(circuit.name);
    expect(drawing.svg).toMatch(/>ÁK1 · Hosszú<\/text><text[^>]+>helyiségmegnevezés/);
  });
  it('draws an explicitly series source terminal inline only without hidden source-side branches',()=>{
    const {data,board,devices}=fixture();board.connections=[];data.circuits=[];
    const terminal=makeDevice('custom',devices);terminal.variant='board-terminal';terminal.electrical={role:'terminal',poles:['L']};
    devices[2].electrical={role:'mcb',poles:['L']};data.devices.push(terminal);
    board.rows[0].placements.push({deviceId:terminal.id,start:4});
    const source={kind:'infeed' as const,infeedId:'grid',pole:0};
    const input={kind:'device' as const,deviceId:terminal.id,side:'bottom' as const,pole:0};
    const output={kind:'device' as const,deviceId:terminal.id,side:'top' as const,pole:0};
    const breaker={kind:'device' as const,deviceId:devices[2].id,side:'top' as const,pole:0};
    board.wiring={infeeds:[{id:'grid',name:'Lakásbetáplálás',kind:'supply',poles:['L'],currentA:16}],buses:[],wires:[
      {id:'feed',from:source,to:input},{id:'out',from:output,to:breaker},
    ]};
    let drawing=buildSingleLineSvg(data,board);
    expect(drawing.svg).toContain(`data-device-id="${terminal.id}" data-pole="0" data-conductor="L" data-source-terminal="true"`);
    expect(drawing.svg).toContain('16 A');
    expect(drawing.svg.match(new RegExp(`data-device-id="${terminal.id}"`,'g'))).toHaveLength(1);
    expect(drawing.svg).toContain('alsó 1 (L) ↔');
    // A branch on the source side cannot be drawn as going through the terminal.
    board.wiring.wires.push({id:'branch',from:source,to:breaker});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    board.wiring.wires.pop();
    board.wiring.wires.push({id:'input-branch',from:input,to:breaker});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    board.wiring.wires.pop();
    board.wiring.buses.push({id:'bad-n',name:'N',conductor:'N',capacity:1,terminalLabels:[],position:'top'});
    board.wiring.wires.push({id:'invalid-branch',from:input,to:{kind:'bus',busId:'bad-n',terminal:0}});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    board.wiring.wires.pop();board.wiring.buses.pop();
    board.wiring.infeeds.push({id:'second',name:'Másik betáp',kind:'supply',poles:['L']});
    board.wiring.wires.push({id:'second-feed',from:{kind:'infeed',infeedId:'second',pole:0},to:output});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    board.wiring.wires.pop();board.wiring.infeeds.pop();
    // Even a branch stored in a different board must block the inference.
    data.boards.push({id:'remote',name:'Másik',rows:[],wiring:{infeeds:[],buses:[],wires:[{id:'remote',from:source,to:breaker}]}});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    data.boards[1].wiring!.wires=[];
    data.circuits.push({id:'remote-circuit',code:'C2',name:'Másik',notes:'',color:'#123456',boardConnections:[{boardId:'remote',terminals:[{conductor:'L',endpoint:input}]}]});
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
    data.circuits=[];
    data.boards.pop();
    terminal.electrical.commonPoleGroups=[[0,1]];
    expect(buildSingleLineSvg(data,board).svg).not.toContain('data-source-terminal="true"');
  });
});
