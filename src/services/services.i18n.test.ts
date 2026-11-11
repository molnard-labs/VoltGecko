import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../i18n';
import { createProject } from '../data/project';
import { makeDevice } from '../catalog';
import { buildPdf } from './pdf';
import { importBackground } from './import';
import { listDriveProjects } from './drive';
import { safeFilename } from './files';

const pdfCalls = vi.hoisted(() => ({ text: [] as string[], language: '' }));
vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor() {
      return new Proxy(this, {
        get(target, property) {
          if (property in target) return Reflect.get(target, property);
          return () => target;
        },
      });
    }
    setLanguage(value: string) { pdfCalls.language = value; }
    text(value: string) { pdfCalls.text.push(value); }
    getTextWidth(value: string) { return value.length; }
    splitTextToSize(value: string) { return [value]; }
    getNumberOfPages() { return 1; }
    output() { return new Blob([pdfCalls.text.join('\n')], { type: 'application/pdf' }); }
  },
}));

afterEach(() => {
  setLanguage('hu');
  vi.unstubAllGlobals();
  pdfCalls.text.length = 0;
});

function stubPdfDiagramRaster() {
  vi.stubGlobal('DOMParser', class { parseFromString() { return { documentElement:{ setAttribute() {} } }; } });
  vi.stubGlobal('XMLSerializer', class { serializeToString() { return '<svg xmlns="http://www.w3.org/2000/svg"/>'; } });
  vi.stubGlobal('Image', class {
    onload?: () => void;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.stubGlobal('document', { documentElement:{lang:''}, title:'', querySelector:() => null,
    createElement: () => ({ width:0, height:0, getContext:() => ({ fillStyle:'', fillRect() {}, drawImage() {} }) }) });
}

describe('service language boundaries', () => {
  it('translates PDF documentation while preserving all user content and the project', async () => {
    setLanguage('en');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    const doc = createProject('Eszközjegyzék');
    doc.data.client = 'Állapot';
    doc.data.notes = 'Megjegyzés';
    doc.data.sheets = [];
    doc.data.boards = [];
    const device = makeDevice('light', []);
    Object.assign(device, { code: 'LÁMPA-01', name: 'Lámpa', room: 'Helyiség', notes: 'Tervezett' });
    doc.data.devices.push(device);
    const before = structuredClone(doc);
    const blob = await buildPdf(doc, 'professional');
    expect(blob.type).toBe('application/pdf');
    expect(pdfCalls.language).toBe('en-GB');
    expect(pdfCalls.text).toContain('DETAILED PLAN DOCUMENTATION');
    expect(pdfCalls.text).toContain('Device schedule');
    expect(pdfCalls.text).toContain('Circuit schedule');
    expect(pdfCalls.text).toContain('Phase connection');
    expect(pdfCalls.text).toContain('Client: Állapot');
    expect(pdfCalls.text).toContain('Planned');
    expect(pdfCalls.text).toContain('LÁMPA-01');
    expect(pdfCalls.text).toContain('Eszközjegyzék');
    expect(pdfCalls.text).toContain('Helyiség');
    expect(pdfCalls.text).toContain('Tervezett');
    expect(pdfCalls.text).toContain('Megjegyzés');
    expect(pdfCalls.text.some(value => value.startsWith('Lámpa\n'))).toBe(true);
    expect(doc).toEqual(before);
    setLanguage('hu');
    pdfCalls.text.length = 0;
    await buildPdf(doc, 'professional');
    expect(pdfCalls.language).toBe('hu');
    expect(pdfCalls.text).toContain('RÉSZLETES TERVDOKUMENTÁCIÓ');
    expect(pdfCalls.text).toContain('Áramkörjegyzék');
    expect(pdfCalls.text).toContain('Megrendelő: Állapot');
    expect(pdfCalls.text).not.toContain('Device schedule');
    expect(doc).toEqual(before);
  });

  it('localizes import and Drive errors and only generates a filename when the name is empty', async () => {
    setLanguage('en');
    await expect(importBackground(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('The selected file is empty.');
    await expect(listDriveProjects()).rejects.toThrow('Reconnect to continue.');
    expect(safeFilename(' . ')).toBe('electrical-plan');
    expect(safeFilename('villamos-terv')).toBe('villamos-terv');
    setLanguage('hu');
    expect(safeFilename(' . ')).toBe('villamos-terv');
    await expect(importBackground(new File([], 'empty.png', { type: 'image/png' }))).rejects.toThrow('A kiválasztott állomány üres.');
  });

  it('includes the placed distribution board name on the floor-plan PDF page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    const doc = createProject('Projekt');
    doc.data.boards[0].name = 'Elosztó A';
    await buildPdf(doc, 'client');
    const without = pdfCalls.text.filter(value => value === 'Elosztó A').length;
    pdfCalls.text.length = 0;
    doc.data.sheets[0].boardPlacements = [{ boardId: doc.data.boards[0].id, x: 250, y: 250 }];
    await buildPdf(doc, 'client');
    expect(pdfCalls.text.filter(value => value === 'Elosztó A')).toHaveLength(without + 1);
  });

  it('shows board markers on the floor plan without a separate route schedule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    const doc = createProject('Projekt');
    const first = doc.data.boards[0];
    first.name = 'Főelosztó';
    const second = { ...structuredClone(first), id: 'second-board', name: 'Műhely elosztó' };
    doc.data.boards.push(second);
    const sheet = doc.data.sheets[0];
    sheet.boardPlacements = [{ boardId: first.id, x: 100, y: 100 }, { boardId: second.id, x: 200, y: 100 }];
    sheet.routes = [{ id: 'route', fromBoardId: first.id, toBoardId: second.id, kind: 'power', points: [] }];
    await buildPdf(doc, 'professional');
    expect(pdfCalls.text).toContain('Főelosztó');
    expect(pdfCalls.text).toContain('Műhely elosztó');
    expect(pdfCalls.text).not.toContain('Kapcsolatjegyzék');
  });

  it('documents migrated circuit terminal connections in the PDF', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    stubPdfDiagramRaster();
    const doc = createProject('Projekt');
    const board = doc.data.boards[0];
    board.name = 'Főelosztó';
    delete doc.data.circuitBoardMigration; // Fixture created by a pre-migration application.
    board.wiring = { wires:[], infeeds:[], buses:[{ id:'n-bus', name:'N sín', conductor:'N', capacity:2, position:'bottom', terminalLabels:['', ''] }] };
    const second = { ...structuredClone(board), id:'other-board', name:'Műhely', wiring:undefined };
    doc.data.boards.push(second);
    doc.data.circuits.push({ id:'circuit', code:'ÁK7', name:'Műhely', color:'#225533', notes:'' });
    const sheet = doc.data.sheets[0];
    sheet.boardPlacements = [{ boardId:board.id, x:100, y:100 }, { boardId:second.id, x:200, y:100 }];
    sheet.routes = [{ id:'r', fromBoardId:board.id, toBoardId:second.id, explicitCircuitId:'circuit', kind:'power', points:[], boardTerminals:[{ boardId:board.id, conductor:'N', endpoint:{kind:'bus',busId:'n-bus',terminal:1} }] }];
    await buildPdf(doc, 'professional');
    const start = pdfCalls.text.indexOf('Főelosztó · áramköri csatlakozások');
    expect(start).toBeGreaterThan(-1);
    const connections = pdfCalls.text.slice(start, start + 15);
    expect(connections).toContain('ÁK7 · Műhely');
    expect(connections).toContain('N sín · 2 (N)');
    expect(pdfCalls.text).toContain('Főelosztó · egyvonalas rajz');
  });

  it('documents canonical circuit terminals even without any floor routes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    stubPdfDiagramRaster();
    const doc = createProject('Projekt');
    const board = doc.data.boards[0];
    board.wiring = {wires:[],infeeds:[],buses:[{id:'pe',name:'PE sín',conductor:'PE',capacity:2,position:'bottom',terminalLabels:[]}]};
    doc.data.circuits = [{id:'c',code:'ÁK1',name:'Dugalj',color:'#ff0000',notes:'',boardConnections:[{boardId:board.id,terminals:[{conductor:'PE',endpoint:{kind:'bus',busId:'pe',terminal:0}}]}]}];
    doc.data.circuitBoardMigration = true;
    await buildPdf(doc, 'professional');
    const connections = pdfCalls.text.slice(pdfCalls.text.indexOf(`${board.name} · áramköri csatlakozások`));
    expect(connections).toContain('ÁK1 · Dugalj');
    expect(connections).toContain('PE sín · 1 (PE)');
    expect(pdfCalls.text).toContain(`${board.name} · egyvonalas rajz`);
  });

  it('prints the actual phase terminal in the professional circuit schedule instead of stale manual protection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    stubPdfDiagramRaster();
    const doc = createProject('Projekt'), board = doc.data.boards[0];
    const old = makeDevice('breaker', []), actual = makeDevice('breaker', [old]);
    old.code = 'OLD_QF'; actual.code = 'LIVE_QF';
    old.electrical = {poles:['L']}; actual.electrical = {poles:['L']};
    old.circuitId = 'own'; actual.circuitId = 'c';
    doc.data.devices.push(old,actual);
    board.rows[0].placements = [{deviceId:old.id,start:0},{deviceId:actual.id,start:1}];
    doc.data.circuits = [
      {id:'c',code:'ÁK1',name:'Dugalj',color:'#ff0000',notes:'',protectionDeviceId:old.id,boardConnections:[{
        boardId:board.id,hidden:true,terminals:[{conductor:'L',endpoint:{kind:'device',deviceId:actual.id,side:'bottom',pole:0}}],
      }]},
      {id:'own',code:'ÁK2',name:'Egyéb',color:'#123456',notes:''},
    ];
    const before = structuredClone(doc);
    await buildPdf(doc, 'professional');
    const circuitSchedule = pdfCalls.text.slice(pdfCalls.text.indexOf('Áramkörjegyzék'));
    expect(circuitSchedule).toContain('Fázisbekötés');
    expect(circuitSchedule).toContain('L · LIVE_QF · alsó 1 (L)');
    expect(circuitSchedule).not.toContain('OLD_QF');
    const deviceSchedule = pdfCalls.text.slice(pdfCalls.text.indexOf(`${board.name} · készülékjegyzék`),pdfCalls.text.indexOf(`${board.name} · áramköri csatlakozások`));
    expect(deviceSchedule[deviceSchedule.indexOf('OLD_QF')+3]).toBe('ÁK2');
    expect(deviceSchedule[deviceSchedule.indexOf('LIVE_QF')+3]).toBe('ÁK1');
    expect(doc).toEqual(before);
  });
});
