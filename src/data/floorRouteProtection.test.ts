import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject, deleteDevice } from './project';
import { decodeProject, encodeProject, validateProject } from './archive';
import { setDeviceCircuit } from './floorRouteCircuit';
import { adoptCircuitProtection, assignFloorRouteTerminal, circuitProtectionStatus, reconcileAutoProtections, routeProtectionStatus, syncCircuitProtection, syncRouteProtection } from './floorRouteProtection';
import type { ProjectData } from '../types';

function fixture() {
  const doc = createProject('Protection');
  const board = doc.data.boards[0];
  const first = makeDevice('breaker', []); first.electrical = { role:'mcb', poles:['L','N'] };
  const second = makeDevice('breaker', [first]); second.electrical = { role:'mcb', poles:['L','N'] };
  const rcd = makeDevice('rcd', [first, second]); rcd.electrical = { role:'rccb', poles:['L','N'] };
  const outlet = makeDevice('outlet', [first, second, rcd]);
  doc.data.devices.push(first, second, rcd, outlet);
  board.rows[0].placements = [{deviceId:first.id,start:0},{deviceId:second.id,start:2},{deviceId:rcd.id,start:4}];
  doc.data.circuits = [{ id:'c1', code:'C1', name:'First', color:'#224466', notes:'' }, { id:'c2', code:'C2', name:'Second', color:'#446622', notes:'' }];
  const sheet = doc.data.sheets[0];
  sheet.boardPlacements = [{boardId:board.id,x:10,y:10}];
  sheet.placements = [{deviceId:outlet.id,x:100,y:10,rotation:0}];
  sheet.routes = [{id:'r1',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',points:[]}];
  const endpoint = (id:string, pole = 0) => ({kind:'device' as const,deviceId:id,side:'bottom' as const,pole});
  return {doc,board,first,second,rcd,outlet,sheet,endpoint};
}

describe('floor routes and circuit protection', () => {
  it('links the unique breaker regardless of whether circuit or terminal was chosen first', () => {
    const {doc,board,first,sheet,endpoint} = fixture();
    const withCircuit = structuredClone(doc.data); withCircuit.sheets[0].routes[0].explicitCircuitId = 'c1';
    const linked = assignFloorRouteTerminal(withCircuit,sheet.id,'r1',board.id,'L',endpoint(first.id));
    expect(linked.circuits[0]).toMatchObject({protectionDeviceId:first.id,protectionAuto:true});
    const terminalFirst = assignFloorRouteTerminal(doc.data,sheet.id,'r1',board.id,'L',endpoint(first.id));
    expect(terminalFirst.circuits[0].protectionDeviceId).toBeUndefined();
    const afterCircuit = structuredClone(terminalFirst); afterCircuit.sheets[0].routes[0].explicitCircuitId = 'c1';
    expect(syncRouteProtection(afterCircuit,sheet.id,'r1').circuits[0].protectionDeviceId).toBe(first.id);
    expect(doc.data.sheets[0].routes[0].boardTerminals).toBeUndefined();
  });
  it('synchronizes a directly assigned breaker and follows later automatic reassignment', () => {
    const {doc,first} = fixture();
    const c1 = syncCircuitProtection(setDeviceCircuit(doc.data,first.id,'c1'),'c1');
    expect(c1.circuits[0]).toMatchObject({protectionDeviceId:first.id,protectionAuto:true});
    const c2 = syncCircuitProtection(setDeviceCircuit(c1,first.id,'c2'),'c2');
    expect(c2.circuits[0].protectionDeviceId).toBeUndefined();
    expect(c2.circuits[0].protectionAuto).toBeUndefined();
    expect(c2.circuits[1]).toMatchObject({protectionDeviceId:first.id,protectionAuto:true});
    const removed = reconcileAutoProtections(deleteDevice(c2,first.id));
    expect(removed.circuits[1].protectionDeviceId).toBeUndefined();
    expect(removed.circuits[1].protectionAuto).toBeUndefined();
  });
  it('preserves legacy or manual selections and exposes conflict for an explicit decision', () => {
    const {doc,board,first,second,sheet,endpoint} = fixture();
    doc.data.circuits[0].protectionDeviceId = first.id;
    doc.data.sheets[0].routes[0].explicitCircuitId = 'c1';
    const linked = assignFloorRouteTerminal(doc.data,sheet.id,'r1',board.id,'L',endpoint(second.id));
    expect(linked.circuits[0].protectionDeviceId).toBe(first.id);
    expect(routeProtectionStatus(linked,sheet.id,'r1')).toMatchObject({kind:'conflict',deviceId:second.id,currentDeviceId:first.id});
    const accepted = adoptCircuitProtection(linked,'c1',second.id);
    expect(accepted.circuits[0]).toMatchObject({protectionDeviceId:second.id});
    expect(accepted.circuits[0].protectionAuto).toBeUndefined();
    expect(reconcileAutoProtections(accepted)).toBe(accepted);
  });
  it('does not infer a protective device from an RCD, a neutral, a control route or another board', () => {
    const {doc,board,first,rcd,sheet,endpoint} = fixture();
    doc.data.sheets[0].routes[0].explicitCircuitId = 'c1';
    const onRcd = assignFloorRouteTerminal(doc.data,sheet.id,'r1',board.id,'L',endpoint(rcd.id));
    expect(onRcd.circuits[0].protectionDeviceId).toBeUndefined();
    const neutral = assignFloorRouteTerminal(doc.data,sheet.id,'r1',board.id,'N',endpoint(first.id,1));
    expect(neutral.circuits[0].protectionDeviceId).toBeUndefined();
    const control = structuredClone(doc.data); control.sheets[0].routes[0].kind = 'control';
    expect(assignFloorRouteTerminal(control,sheet.id,'r1',board.id,'L',endpoint(first.id)).circuits[0].protectionDeviceId).toBeUndefined();
    expect(assignFloorRouteTerminal(doc.data,sheet.id,'r1','other','L',endpoint(first.id))).toBe(doc.data);
  });
  it('does not choose arbitrarily between multiple breakers or leave a stale automatic value', () => {
    const {doc,board,first,second,sheet,endpoint} = fixture();
    doc.data.sheets[0].routes[0].explicitCircuitId = 'c1';
    let data = assignFloorRouteTerminal(doc.data,sheet.id,'r1',board.id,'L',endpoint(first.id));
    data = setDeviceCircuit(data,second.id,'c1');
    data = syncCircuitProtection(data,'c1');
    expect(circuitProtectionStatus(data,'c1').kind).toBe('ambiguous');
    expect(data.circuits[0].protectionDeviceId).toBeUndefined();
    data = setDeviceCircuit(data,second.id,undefined);
    data = reconcileAutoProtections(data);
    expect(data.circuits[0].protectionDeviceId).toBe(first.id);
  });
  it('does not refill a manually cleared circuit on unrelated edits and round-trips provenance', async () => {
    const {doc,first} = fixture();
    let data: ProjectData = syncCircuitProtection(setDeviceCircuit(doc.data,first.id,'c1'),'c1');
    const saved = await decodeProject(await encodeProject({...doc,data}));
    expect(saved.data.circuits[0]).toMatchObject({protectionDeviceId:first.id,protectionAuto:true});
    data = structuredClone(saved.data);
    delete data.circuits[0].protectionDeviceId; delete data.circuits[0].protectionAuto;
    data.name = 'Changed';
    expect(reconcileAutoProtections(data).circuits[0].protectionDeviceId).toBeUndefined();
    expect(() => validateProject({...doc,data})).not.toThrow();
  });
  it('does not refill a manually cleared protection when only neutral or earth is edited', () => {
    const {doc,board,first,sheet,endpoint} = fixture();
    let data = syncCircuitProtection(setDeviceCircuit(doc.data,first.id,'c1'),'c1');
    data = structuredClone(data);
    data.sheets[0].routes[0].explicitCircuitId = 'c1';
    delete data.circuits[0].protectionDeviceId;
    delete data.circuits[0].protectionAuto;
    data = assignFloorRouteTerminal(data,sheet.id,'r1',board.id,'N',endpoint(first.id,1));
    expect(data.circuits[0].protectionDeviceId).toBeUndefined();
    data = assignFloorRouteTerminal(data,sheet.id,'r1',board.id,'N');
    expect(data.circuits[0].protectionDeviceId).toBeUndefined();
    data = assignFloorRouteTerminal(data,sheet.id,'r1',board.id,'L',endpoint(first.id));
    expect(data.circuits[0].protectionDeviceId).toBe(first.id);
  });
});
