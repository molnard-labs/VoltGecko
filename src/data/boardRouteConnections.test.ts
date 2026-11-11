import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { BoardRouteTerminal } from '../types';
import { createProject, checkpoint, deleteDevice, restoreRevision } from './project';
import { decodeProject, encodeProject, validateProject } from './archive';
import { floorRouteCircuitId, setDeviceCircuit } from './floorRouteCircuit';
import { isBoardRouteTerminalCompatible, pruneInvalidBoardRouteTerminals } from './boardRouteConnections';

function fixture() {
  const doc = createProject('Projekt');
  const board = doc.data.boards[0];
  const breaker = makeDevice('breaker', []);
  breaker.electrical = { poles: ['L', 'N'] };
  breaker.moduleWidth = 2;
  const outlet = makeDevice('outlet', [breaker]);
  outlet.circuitId = 'inferred';
  doc.data.devices.push(breaker, outlet);
  doc.data.circuits = [
    { id:'inferred', code:'A', name:'A', color:'#000000', notes:'' },
    { id:'chosen', code:'B', name:'B', color:'#000000', notes:'' },
  ];
  board.rows[0].placements.push({ deviceId:breaker.id, start:0 });
  board.wiring = { buses:[{ id:'pe', name:'PE', conductor:'PE', capacity:4, position:'bottom', terminalLabels:[] }], wires:[], infeeds:[] };
  const sheet = doc.data.sheets[0];
  sheet.boardPlacements = [{boardId:board.id,x:30,y:40}];
  sheet.placements = [{deviceId:outlet.id,x:100,y:40,rotation:0}];
  const terminals: BoardRouteTerminal[] = [
    {boardId:board.id,conductor:'L',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:0}},
    {boardId:board.id,conductor:'N',endpoint:{kind:'device',deviceId:breaker.id,side:'bottom',pole:1}},
    {boardId:board.id,conductor:'PE',endpoint:{kind:'bus',busId:'pe',terminal:0}},
  ];
  sheet.routes = [{id:'route',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',points:[],explicitCircuitId:'chosen',boardTerminals:terminals}];
  return { doc, board, breaker, outlet, terminals };
}

describe('floor route cabinet terminals', () => {
  it('keeps explicit circuit selection and all conductor terminals through archive and history', async () => {
    const {doc,outlet} = fixture();
    const saved = checkpoint(doc, 'Before');
    const reopened = await decodeProject(await encodeProject(saved));
    expect(reopened.data.sheets[0].routes[0]).toEqual(doc.data.sheets[0].routes[0]);
    expect(reopened.revisions[0].data.sheets[0].routes[0]).toEqual(doc.data.sheets[0].routes[0]);
    const removed = { ...reopened, data: deleteDevice(reopened.data, doc.data.boards[0].rows[0].placements[0].deviceId) };
    const restored = restoreRevision(removed, reopened.revisions[0].id);
    expect(restored.data.sheets[0].routes[0]).toEqual(doc.data.sheets[0].routes[0]);
    expect(() => validateProject(restored)).not.toThrow();
    const devices = new Map(doc.data.devices.map(device => [device.id, device]));
    expect(floorRouteCircuitId(doc.data.sheets[0].routes[0],devices)).toBe('chosen');
    const changed = setDeviceCircuit(doc.data,outlet.id,undefined);
    expect(changed.sheets[0].routes[0].explicitCircuitId).toBe('chosen');
    expect(changed.sheets[0].routes[0].circuitId).toBeUndefined();
  });
  it('filters choices by board and conductor while retaining changed conductor information', () => {
    const {doc,board,breaker,terminals} = fixture();
    expect(isBoardRouteTerminalCompatible(doc.data,board.id,'L',terminals[0].endpoint)).toBe(true);
    expect(isBoardRouteTerminalCompatible(doc.data,board.id,'PE',terminals[0].endpoint)).toBe(false);
    expect(isBoardRouteTerminalCompatible(doc.data,board.id,'N',terminals[2].endpoint)).toBe(false);
    breaker.electrical!.poles[0] = 'L1';
    expect(isBoardRouteTerminalCompatible(doc.data,board.id,'L',terminals[0].endpoint)).toBe(true);
    breaker.electrical!.poles[0] = 'N';
    expect(pruneInvalidBoardRouteTerminals(doc.data).sheets[0].routes[0].boardTerminals).toHaveLength(3);
    expect(() => validateProject(doc)).not.toThrow();
  });
  it('removes disappeared terminal references and missing circuit selections without touching others', () => {
    const {doc,board} = fixture();
    board.wiring!.buses = [];
    doc.data.circuits = doc.data.circuits.filter(circuit => circuit.id !== 'chosen');
    const cleaned = pruneInvalidBoardRouteTerminals(doc.data);
    expect(cleaned.sheets[0].routes[0].boardTerminals).toHaveLength(2);
    expect(cleaned.sheets[0].routes[0].explicitCircuitId).toBeUndefined();
    expect(() => validateProject({...doc,data:cleaned})).not.toThrow();
    expect(doc.data.sheets[0].routes[0].boardTerminals).toHaveLength(3);
  });
  it('removes only the deleted cabinet device terminal references', () => {
    const {doc,breaker} = fixture();
    const changed = deleteDevice(doc.data, breaker.id);
    expect(changed.sheets[0].routes[0].boardTerminals?.map(terminal => terminal.conductor)).toEqual(['PE']);
    expect(() => validateProject({...doc,data:changed})).not.toThrow();
  });
  it('rejects duplicated conductors, wrong board references and invalid terminals on import', () => {
    const {doc,terminals} = fixture();
    const bad = structuredClone(doc);
    bad.data.sheets[0].routes[0].boardTerminals!.push(terminals[0]);
    expect(() => validateProject(bad)).toThrow();
    const missing = structuredClone(doc);
    missing.data.sheets[0].routes[0].boardTerminals![0].endpoint = {kind:'bus',busId:'missing',terminal:0};
    expect(() => validateProject(missing)).toThrow();
    const wrongCircuit = structuredClone(doc);
    wrongCircuit.data.sheets[0].routes[0].explicitCircuitId = 'missing';
    expect(() => validateProject(wrongCircuit)).toThrow();
  });
});
