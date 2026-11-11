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

  it('includes board endpoints in the professional PDF connection schedule', async () => {
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
    const schedule = pdfCalls.text.slice(pdfCalls.text.indexOf('Kapcsolatjegyzék'));
    expect(schedule).toContain('Kiinduló pont');
    expect(schedule).toContain('Főelosztó');
    expect(schedule).toContain('Műhely elosztó');
  });

  it('documents floor routes and their assigned board terminals in the PDF', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    const doc = createProject('Projekt');
    const board = doc.data.boards[0];
    board.name = 'Főelosztó';
    board.wiring = { wires:[], infeeds:[], buses:[{ id:'n-bus', name:'N sín', conductor:'N', capacity:2, position:'bottom', terminalLabels:['', ''] }] };
    const second = { ...structuredClone(board), id:'other-board', name:'Műhely', wiring:undefined };
    doc.data.boards.push(second);
    doc.data.circuits.push({ id:'circuit', code:'ÁK7', name:'Műhely', color:'#225533', notes:'' });
    const sheet = doc.data.sheets[0];
    sheet.boardPlacements = [{ boardId:board.id, x:100, y:100 }, { boardId:second.id, x:200, y:100 }];
    sheet.routes = [{ id:'r', fromBoardId:board.id, toBoardId:second.id, explicitCircuitId:'circuit', kind:'power', points:[], boardTerminals:[{ boardId:board.id, conductor:'N', endpoint:{kind:'bus',busId:'n-bus',terminal:1} }] }];
    await buildPdf(doc, 'professional');
    const start = pdfCalls.text.indexOf('Főelosztó · alaprajzi csatlakozások');
    expect(start).toBeGreaterThan(-1);
    const connections = pdfCalls.text.slice(start, start + 15);
    expect(connections).toContain('Műhely');
    expect(connections).toContain('ÁK7 · Műhely');
    expect(connections).toContain('N sín · 2 (N)');
  });

  it('uses current device circuit assignments in the PDF connection schedule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer }));
    const doc = createProject('Projekt');
    const device = makeDevice('outlet', []);
    device.circuitId = 'new';
    doc.data.devices.push(device);
    doc.data.circuits = [
      { id:'old', code:'OLD', name:'Old', color:'#888888', notes:'' },
      { id:'new', code:'NEW', name:'New', color:'#ff0000', notes:'' },
    ];
    const sheet = doc.data.sheets[0];
    sheet.boardPlacements = [{ boardId:doc.data.boards[0].id, x:200, y:100 }];
    sheet.routes = [{ id:'r', fromDeviceId:device.id, toBoardId:doc.data.boards[0].id, circuitId:'old', kind:'power', points:[] }];
    await buildPdf(doc, 'professional');
    const schedule = pdfCalls.text.slice(pdfCalls.text.indexOf('Kapcsolatjegyzék'));
    expect(schedule).toContain('NEW');
    expect(schedule).not.toContain('OLD');
  });
});
