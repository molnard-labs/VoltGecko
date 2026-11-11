import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { Board, BoardWire, WiringEndpoint } from '../types';
import { createProject } from './project';
import { buildBoardTopology, topologyEndpointKey } from './boardTopology';

const device = (id:string, side:'top'|'bottom', pole=0):WiringEndpoint => ({kind:'device',deviceId:id,side,pole});
const infeed = (id:string,pole:number):WiringEndpoint => ({kind:'infeed',infeedId:id,pole});
const bus = (id:string,terminal=0):WiringEndpoint => ({kind:'bus',busId:id,terminal});
const wire = (id:string,from:WiringEndpoint,to:WiringEndpoint):BoardWire => ({id,from,to});

function fixture() {
  const doc=createProject('Topology'), board=doc.data.boards[0];
  const rcd=makeDevice('rcd',[]); rcd.id='fi'; rcd.code='FI1'; rcd.electrical={role:'rccb',poles:['L','N']}; rcd.moduleWidth=2;
  const breaker=makeDevice('breaker',[rcd]); breaker.id='qf'; breaker.code='QF1'; breaker.electrical={role:'mcb',poles:['L']}; breaker.moduleWidth=1;
  doc.data.devices=[rcd,breaker];
  board.rows[0].placements=[{deviceId:'fi',start:0},{deviceId:'qf',start:2}];
  board.wiring={infeeds:[{id:'source',name:'Bejövő',kind:'supply',poles:['L','N','PE']}],
    buses:[{id:'pe',name:'PE',conductor:'PE',capacity:3,position:'bottom',terminalLabels:[]}],wires:[]};
  doc.data.circuits=[{id:'c',code:'ÁK1',name:'Kör',notes:'',color:'#123456'}];
  return {doc,board,rcd,breaker};
}

describe('board terminal topology',()=>{
  it('preserves FI L and N as separate through-poles, PE separately, and follows each supplied path',()=>{
    const {doc,board}=fixture();
    board.wiring!.wires=[wire('l',infeed('source',0),device('fi','top',0)),
      wire('n',infeed('source',1),device('fi','top',1)),wire('lout',device('fi','bottom',0),device('qf','top')),
      wire('pe',infeed('source',2),bus('pe',0))];
    doc.data.circuits[0].boardConnections=[{boardId:board.id,terminals:[
      {conductor:'L',endpoint:device('qf','bottom')},{conductor:'N',endpoint:device('fi','bottom',1)},{conductor:'PE',endpoint:bus('pe',2)}
    ]}];
    const topology=buildBoardTopology(doc.data,board);
    const fi=topology.devices.find(item=>item.device.id==='fi')!;
    const [l,n]=fi.poles;
    expect(l.through).toBe(true); expect(n.through).toBe(true);
    expect(l.top.netId).not.toBe(l.bottom.netId); expect(n.top.netId).not.toBe(n.bottom.netId);
    expect(new Set([l.top.netId,n.top.netId,topology.buses[0].netId]).size).toBe(3);
    expect(l.top.netId).not.toBe(n.top.netId); expect(l.bottom.netId).not.toBe(n.bottom.netId);
    const c=topology.circuits[0].connections;
    expect(new Set(c.map(item=>item.netId)).size).toBe(3);
    for (const item of c) {
      const net=topology.nets.find(net=>net.id===item.netId)!;
      expect(net.reachable).toBe(true);
      expect(net.reachableSources.map(source=>source.conductor)).toEqual([item.conductor]);
    }
    expect(topology.buses[0].terminals.map(item=>item.netId)).toEqual(Array(3).fill(topology.buses[0].netId));
  });

  it('retains an incompatible physical L/N wire as an error without merging the nets or propagating supply',()=>{
    const {doc,board}=fixture();
    board.wiring!.wires=[wire('bad',infeed('source',0),device('fi','top',1))];
    const topology=buildBoardTopology(doc.data,board), bad=topology.wires[0];
    expect(bad.valid).toBe(true); expect(bad.incompatible).toBe(true);
    expect(bad.fromNetId).not.toBe(bad.toNetId);
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'conductor',severity:'error',wireId:'bad'}));
    expect(topology.nets.find(net=>net.id===bad.toNetId)?.reachable).toBe(false);
  });

  it('flags a generic L net connected to two different actual phases',()=>{
    const {doc,board}=fixture();
    board.wiring!.infeeds[0].poles=['L1','L2'];
    board.wiring!.wires=[wire('l1',infeed('source',0),device('qf','top')),wire('l2',infeed('source',1),device('qf','top'))];
    const topology=buildBoardTopology(doc.data,board),net=topology.nets.find(item=>item.id===topology.wires[0].toNetId)!;
    expect(net.conductors).toEqual(expect.arrayContaining(['L','L1','L2']));
    expect(net.conflicted).toBe(true);
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'phase-conflict',severity:'error'}));
  });

  it('models FLEAL pass-through and only explicitly common FLECU screw groups',()=>{
    const {doc,board}=fixture();
    const fleal=makeDevice('custom',doc.data.devices); fleal.id='fleal'; fleal.code='X1'; fleal.moduleWidth=1;
    fleal.electrical={role:'terminal',poles:['N']};
    const flecu=makeDevice('custom',doc.data.devices); flecu.id='flecu'; flecu.code='X2'; flecu.moduleWidth=1;
    flecu.electrical={role:'terminal',poles:['L','L','L','N'],commonPoleGroups:[[0,1,2]]};
    doc.data.devices.push(fleal,flecu); board.rows[0].placements.push({deviceId:'fleal',start:4},{deviceId:'flecu',start:5});
    const topology=buildBoardTopology(doc.data,board), a=topology.devices.find(item=>item.device.id==='fleal')!, b=topology.devices.find(item=>item.device.id==='flecu')!;
    expect(a.poles[0].top.netId).toBe(a.poles[0].bottom.netId);
    expect(new Set(b.poles.slice(0,3).flatMap(pole=>[pole.top.netId,pole.bottom.netId])).size).toBe(1);
    expect(b.poles[3].top.netId).not.toBe(b.poles[0].top.netId);
  });

  it('does not guess a connection through an SPD or an unknown custom device',()=>{
    const {doc,board}=fixture();
    const spd=makeDevice('spd',doc.data.devices); spd.id='spd'; spd.moduleWidth=1; spd.electrical={role:'spd',poles:['L']};
    const unknown=makeDevice('custom',doc.data.devices); unknown.id='unknown'; unknown.moduleWidth=1; unknown.electrical={poles:['L']};
    doc.data.devices.push(spd,unknown); board.rows[0].placements.push({deviceId:'spd',start:4},{deviceId:'unknown',start:5});
    board.wiring!.wires=[wire('input',infeed('source',0),device('spd','top'))];
    const topology=buildBoardTopology(doc.data,board);
    for (const id of ['spd','unknown']) {
      const pole=topology.devices.find(item=>item.device.id===id)!.poles[0];
      expect(pole.through).toBe(false); expect(pole.top.netId).not.toBe(pole.bottom.netId);
    }
    expect(topology.nets.find(net=>net.id===topology.devices.find(item=>item.device.id==='spd')!.poles[0].bottom.netId)?.reachable).toBe(false);
  });

  it('marks kind-only default poles as inferred and does not assert an internal connection',()=>{
    const {doc,board,breaker}=fixture();
    delete breaker.electrical;
    const item=buildBoardTopology(doc.data,board).devices.find(value=>value.device.id===breaker.id)!;
    expect(item.poleDefinition).toBe('inferred');
    expect(item.poles[0].through).toBe(false);
    expect(item.poles[0].top.netId).not.toBe(item.poles[0].bottom.netId);
  });

  it('does not treat a generic 2P product count as evidence of L and N pole functions',()=>{
    const {doc,board,breaker}=fixture();
    delete breaker.electrical;
    breaker.product={reference:'2P',manufacturer:'X',range:'X',sourceUrl:'',sourceDocument:'',sourcePage:1,
      verifiedAt:'2026-01-01',mounting:'din',poles:'2P'};
    const item=buildBoardTopology(doc.data,board).devices.find(value=>value.device.id===breaker.id)!;
    expect(item.poleDefinition).toBe('product');
    expect(item.poles).toHaveLength(2);
    expect(item.poles.every(pole=>!pole.through)).toBe(true);
  });

  it('does not invent which side of a supply-role device is its source',()=>{
    const {doc,board,breaker}=fixture();
    breaker.electrical={role:'supply',poles:['L']};
    const result=buildBoardTopology(doc.data,board), item=result.devices.find(value=>value.device.id===breaker.id)!;
    expect(item.sourceSideUnspecified).toBe(true);
    expect(item.poles[0].through).toBe(false);
    expect(result.nets.find(net=>net.id===item.poles[0].top.netId)?.sources).toEqual([]);
    expect(result.nets.find(net=>net.id===item.poles[0].bottom.netId)?.sources).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({code:'source-side-unverified',deviceId:breaker.id}));
    expect(result.infeeds[0].poles[0].terminal.netId).toBe(result.infeeds[0].poles[0].netId);
    expect(result.nets.find(net=>net.id===result.infeeds[0].poles[0].netId)?.sources).toHaveLength(1);
  });

  it('reports an incompatible explicit terminal group without merging N and L',()=>{
    const {doc,board}=fixture();
    const terminal=makeDevice('custom',doc.data.devices); terminal.id='terminal'; terminal.code='X1'; terminal.moduleWidth=1;
    terminal.electrical={role:'terminal',poles:['L','N'],commonPoleGroups:[[0,1]]};
    doc.data.devices.push(terminal); board.rows[0].placements.push({deviceId:'terminal',start:4});
    const result=buildBoardTopology(doc.data,board), item=result.devices.find(value=>value.device.id==='terminal')!;
    expect(item.poles[0].top.netId).not.toBe(item.poles[1].top.netId);
    expect(result.issues).toContainEqual(expect.objectContaining({code:'common-pole-conductor',severity:'error',deviceId:'terminal'}));
  });

  it('preserves hidden circuits, legacy ambiguity and detailed wire loops without inventing edges',()=>{
    const {doc,board}=fixture();
    const endpoint=device('qf','bottom');
    doc.data.circuits[0].hideOnBoards=true;
    doc.data.circuits[0].boardConnections=[{boardId:board.id,hidden:true,terminals:[{conductor:'L',endpoint}],
      legacyTerminalConflicts:[{conductor:'N',endpoints:[device('fi','top',1),device('fi','bottom',1)]}]}];
    board.connections=[{id:'old',toDeviceId:'qf'}];
    board.wiring!.wires=[wire('a',infeed('source',0),device('qf','top')),wire('b',infeed('source',0),device('qf','top'))];
    const topology=buildBoardTopology(doc.data,board), circuit=topology.circuits[0];
    expect(circuit.connections).toHaveLength(1); expect(circuit.unresolved).toHaveLength(1);
    expect(topology.legacy).toEqual([{boardId:board.id,connection:board.connections[0]}]);
    expect(topology.wires.map(item=>item.wire.id)).toEqual(['a','b']);
    expect(topology.nets.find(net=>net.id===circuit.connections[0].netId)?.circuits[0].terminalKey).toBe(topologyEndpointKey(endpoint));
  });

  it('retains legacy missing endpoints, parallel feed warnings and cycles as explicitly incomplete information',()=>{
    const {doc,board}=fixture();
    board.connections=[{id:'a',fromDeviceId:'fi',toDeviceId:'qf'},{id:'b',fromDeviceId:'qf',toDeviceId:'fi'},
      {id:'missing',fromDeviceId:'unknown',toDeviceId:'qf'},{id:'c',toDeviceId:'qf'}];
    const topology=buildBoardTopology(doc.data,board);
    expect(topology.legacy.map(item=>item.connection.id)).toEqual(['a','b','missing','c']);
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'legacy-cycle'}));
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'legacy-missing',connectionId:'missing'}));
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'legacy-multiple'}));
  });

  it('handles a long legacy cycle iteratively without dropping any device or edge',()=>{
    const {doc,board,breaker}=fixture();
    board.rows=[];
    doc.data.devices=Array.from({length:1200},(_,index)=>({...breaker,id:`q${index}`,code:`Q${index}`}));
    board.connections=doc.data.devices.map((item,index)=>({id:`edge-${index}`,fromDeviceId:item.id,toDeviceId:doc.data.devices[(index+1)%doc.data.devices.length].id}));
    const topology=buildBoardTopology(doc.data,board);
    expect(topology.devices).toHaveLength(1200); expect(topology.legacy).toHaveLength(1200);
    expect(topology.issues).toContainEqual(expect.objectContaining({code:'legacy-cycle'}));
  });

  it('retains actual cross-board endpoints and electrical reachability without merging circuit boards',()=>{
    const {doc,board}=fixture();
    const other:Board={id:'other',name:'Másik elosztó',rows:[{id:'row',name:'Sor',capacity:4,placements:[{deviceId:'remote',start:0}]}],
      wiring:{buses:[],infeeds:[],wires:[]}};
    const remote=makeDevice('breaker',doc.data.devices); remote.id='remote'; remote.code='QF2'; remote.moduleWidth=1; remote.electrical={role:'mcb',poles:['L']};
    doc.data.devices.push(remote); doc.data.boards.push(other);
    board.wiring!.wires=[wire('cross',infeed('source',0),device('remote','top'))];
    doc.data.circuits[0].boardConnections=[{boardId:other.id,terminals:[{conductor:'L',endpoint:device('remote','bottom')}]}];
    const first=buildBoardTopology(doc.data,board),second=buildBoardTopology(doc.data,other);
    expect(first.devices.find(item=>item.device.id==='remote')?.boardId).toBe('other');
    expect(first.wires[0].to.endpoint).toEqual(device('remote','top'));
    expect(second.circuits[0].connections[0].boardId).toBe('other');
    const remoteNet=second.circuits[0].connections[0].netId;
    expect(second.nets.find(net=>net.id===remoteNet)?.reachableSources.some(source=>source.infeedId==='source')).toBe(true);
    // A wire stored on the other board must also remain in this drawing if
    // either end is local; keep its original owner for cross-reference.
    other.wiring!.wires=[wire('other-owned',device('remote','bottom'),device('qf','top'))];
    const firstAgain=buildBoardTopology(doc.data,board);
    const otherOwned=firstAgain.wires.find(item=>item.wire.id==='other-owned');
    expect(otherOwned?.boardId).toBe('other');
    expect(otherOwned?.to.endpoint).toEqual(device('qf','top'));
  });
});
