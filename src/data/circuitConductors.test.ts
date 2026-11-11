import { describe, expect, it } from 'vitest';
import type { Circuit } from '../types';
import { decodeProject, encodeProject, validateProject } from './archive';
import { availableCircuitConductors, confirmCircuitConductors, includeRecordedCircuitConductors, recordedCircuitConductors, selectedCircuitConductors, setCircuitConductor } from './circuitConductors';
import { createProject } from './project';

function fixture() {
  const doc = createProject('Circuit conductors');
  const board = doc.data.boards[0];
  board.wiring = {wires:[],buses:[],infeeds:[{id:'feed',name:'Feed',kind:'supply',poles:['L','N','PE']}]};
  const circuit:Circuit = {id:'c',code:'C',name:'Circuit',color:'#123456',notes:'',phase:'L',cableDetails:{cores:5,crossSectionMm2:2.5}};
  doc.data.circuits = [circuit];
  return {doc,board,circuit};
}

describe('circuit conductor selection',()=>{
  it('offers actual supply and earth conductors without inventing extra phases',()=>{
    const {doc,board,circuit}=fixture();
    expect(availableCircuitConductors(doc.data,circuit)).toEqual(['L','N','PE']);
    board.wiring!.infeeds=[{id:'three',name:'Three phase',kind:'supply',poles:['L1','L2','L3','N']},
      {id:'earth',name:'Earth',kind:'earth',poles:['PE']}];
    expect(availableCircuitConductors(doc.data,circuit)).toEqual(['L1','L2','L3','N','PE']);
    board.wiring!.infeeds=[];
    expect(availableCircuitConductors(doc.data,circuit)).toEqual([]);
    expect(selectedCircuitConductors(circuit)).toEqual(['L']);
  });

  it('uses only the associated boards when several boards exist',()=>{
    const {doc,board,circuit}=fixture();
    doc.data.boards.push({id:'other',name:'Other',rows:[],wiring:{wires:[],buses:[],infeeds:[{id:'feed2',name:'Other',kind:'supply',poles:['L1','L2','L3','PEN']}]}});
    expect(availableCircuitConductors(doc.data,circuit)).toEqual([]);
    circuit.boardConnections=[{boardId:board.id,terminals:[]}];
    expect(availableCircuitConductors(doc.data,circuit)).toEqual(['L','N','PE']);
    circuit.boardConnections.push({boardId:'other',terminals:[]});
    expect(availableCircuitConductors(doc.data,circuit)).toEqual(['L','L1','L2','L3','N','PE','PEN']);
  });

  it('stores the explicit choice, syncs a single old phase, and preserves legacy cable data',async()=>{
    const {doc,circuit}=fixture(),original=structuredClone(doc.data);
    let data=setCircuitConductor(doc.data,'c','N',true);
    data=setCircuitConductor(data,'c','PE',true);
    expect(data.circuits[0]).toMatchObject({conductors:['L','N','PE'],phase:'L',cableDetails:{cores:5,crossSectionMm2:2.5}});
    expect(doc.data).toEqual(original);
    expect((await decodeProject(await encodeProject({...doc,data}))).data.circuits[0]).toMatchObject({conductors:['L','N','PE'],phase:'L',cableDetails:{cores:5}});
    expect(circuit.conductors).toBeUndefined();
    expect(()=>validateProject({...doc,data:{...data,circuits:[{...data.circuits[0],conductors:['L','L']}]}})).toThrow();
    expect(()=>validateProject({...doc,data:{...data,circuits:[{...data.circuits[0],conductors:['bogus']}]}})).toThrow();
  });

  it('retains physical and unresolved connections and refuses to uncheck them',()=>{
    const {doc,board,circuit}=fixture();
    circuit.boardConnections=[{boardId:board.id,terminals:[{conductor:'N',endpoint:{kind:'infeed',infeedId:'feed',pole:1}}],
      legacyTerminalConflicts:[{conductor:'PE',endpoints:[]}]}];
    expect(recordedCircuitConductors(circuit)).toEqual(['N','PE']);
    expect(selectedCircuitConductors(circuit)).toEqual(['L','N','PE']);
    expect(setCircuitConductor(doc.data,'c','N',false)).toBe(doc.data);
    expect(setCircuitConductor(doc.data,'c','PE',false)).toBe(doc.data);
    const next=setCircuitConductor(doc.data,'c','L',false);
    expect(next.circuits[0].conductors).toEqual(['N','PE']);
    expect(next.circuits[0].phase).toBeUndefined();
    expect(next.circuits[0].boardConnections).toEqual(circuit.boardConnections);
    const confirmed=confirmCircuitConductors(doc.data,'c');
    expect(confirmed.circuits[0].conductors).toEqual(['L','N','PE']);
    expect(confirmed.circuits[0].boardConnections).toEqual(circuit.boardConnections);
    expect(circuit.conductors).toBeUndefined();
  });

  it('keeps conflicting imported connections visible until the user reconciles the selection',()=>{
    const {doc,board,circuit}=fixture();
    circuit.conductors=['L'];
    circuit.boardConnections=[{boardId:board.id,terminals:[{conductor:'N',endpoint:{kind:'infeed',infeedId:'feed',pole:1}}]}];
    expect(selectedCircuitConductors(circuit)).toEqual(['L','N']);
    expect(circuit.conductors).toEqual(['L']);
    expect(setCircuitConductor(doc.data,'c','PE',true)).toBe(doc.data);
    const resolved=includeRecordedCircuitConductors(doc.data,'c');
    expect(resolved.circuits[0].conductors).toEqual(['L','N']);
    expect(resolved.circuits[0].boardConnections).toEqual(circuit.boardConnections);
    expect(doc.data.circuits[0].conductors).toEqual(['L']);
  });

  it('distinguishes explicitly empty from legacy and preserves multiple phase selections',()=>{
    const {doc,board,circuit}=fixture();
    board.wiring!.infeeds=[{id:'three',name:'Three phase',kind:'supply',poles:['L1','L2','L3','N','PE']}];
    circuit.phase=undefined;
    let data=setCircuitConductor(doc.data,'c','L1',true);
    data=setCircuitConductor(data,'c','L2',true);
    expect(data.circuits[0].conductors).toEqual(['L1','L2']);
    expect(data.circuits[0].phase).toBeUndefined();
    data=setCircuitConductor(data,'c','L1',false);
    expect(data.circuits[0].phase).toBe('L2');
    data=setCircuitConductor(data,'c','L2',false);
    expect(data.circuits[0].conductors).toEqual([]);
    expect(data.circuits[0].phase).toBeUndefined();
  });
});
