import { afterEach, describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject } from '../data/project';
import { setLanguage } from '../i18n';
import { buildSingleLineSvg, buildProjectSingleLineSvg, circuitCableLabel } from './singleLine';
import { diagramTiles } from './diagramPages';
import type { Device } from '../types';

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
    expect(svg).toContain('stroke-dasharray="6 4"');
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
  it('exports an explicit green-yellow wire as two strokes while preserving solid custom greens', () => {
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
    const drawing = buildSingleLineSvg(data, board).svg;
    const striped = drawing.match(/<g data-connection-id="striped-earth"[\s\S]*?<\/g>/)![0];
    const solid = drawing.match(/<g data-connection-id="custom-green"[\s\S]*?<\/g>/)![0];
    expect(striped.match(/<path /g)).toHaveLength(2);
    expect(striped).toContain('stroke="#2f9e44"');
    expect(striped).toContain('stroke="#f2cf1d"');
    expect(striped).toContain('stroke-dasharray="7 7"');
    expect(solid.match(/<path /g)).toHaveLength(1);
    expect(solid).not.toContain('stroke-dasharray');
  });
  it('retains manual circuit cable descriptions when only structured length is added',()=>{
    expect(circuitCableLabel({id:'c',code:'C',name:'Load',notes:'',color:'#123456',cable:'Existing NYM-J 3×2.5',cableDetails:{lengthM:10}})).toBe('Existing NYM-J 3×2.5 · 10 m');
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
    expect(result.svg.match(/Nincs megadva a bemenet/g)).toHaveLength(4);
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
    // Each line must be traceable around cards, including the cycle's side routes.
    const edgePaths = [...result.svg.matchAll(/data-connection-index="\d+"><title>.*?<\/title><path d="([^"]+)"/g)].map(match => match[1]);
    expect(edgePaths).toHaveLength(8);
    for (const path of edgePaths) {
      let x = 0; let y = 0;
      for (const match of path.matchAll(/([MHV])([^MHV]+)/g)) {
        const values = match[2].trim().split(/\s+/).map(Number);
        if (match[1] === 'M') { [x, y] = values; continue; }
        const nx = match[1] === 'H' ? values[0] : x;
        const ny = match[1] === 'V' ? values[0] : y;
        for (const block of result.blocks) {
          const horizontalIntersection = y === ny && y > block.y && y < block.y + block.height && Math.max(x, nx) > block.x && Math.min(x, nx) < block.x + block.width;
          const verticalIntersection = x === nx && x > block.x && x < block.x + block.width && Math.max(y, ny) > block.y && Math.min(y, ny) < block.y + block.height;
          expect(horizontalIntersection || verticalIntersection).toBe(false);
        }
        x = nx; y = ny;
      }
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
    expect(result.svg).toContain('Hiányzó készülék');
    expect(result.svg).toContain('deleted-meter');
    expect(result.svg.match(/data-connection-id=/g)).toHaveLength(6);
  });
  it('includes board-assigned DIN devices and attaches a circuit only at its explicit protective device', () => {
    const { data, board, devices } = fixture();
    const unplaced = makeDevice('rcbo', devices); unplaced.boardId = board.id;
    data.devices.push(unplaced);
    devices[1].circuitId = 'shared';
    data.circuits.push({ id: 'shared', code: 'C1', name: 'Explicit protection', color: '#287c68', notes: '', protectionDeviceId: unplaced.id, cable: '5 × 2,5 mm²', powerW: 9000 });
    const result = buildSingleLineSvg(data, board);
    expect(result.svg).toContain(`data-device-id="${unplaced.id}"`);
    // The visible circuit label and its title occur once each on the protective device.
    expect(result.svg.match(/Áramkör-hozzárendelés: C1/g)).toHaveLength(1);
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
    expect(result.svg).not.toMatch(/NaN|Infinity/);
    expect(result.width).toBeLessThan(2500);
    expect(result.height).toBeLessThan(100_000);
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
    expect(result.svg).toContain('Input unspecified');
    expect(result.svg).toContain('Single-line diagram');
    expect(result.svg).not.toContain('Nincs megadva a bemenet');
  });
});
