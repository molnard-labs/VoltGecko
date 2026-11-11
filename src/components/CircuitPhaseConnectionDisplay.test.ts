import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject } from '../data/project';
import { getCircuitPhaseConnections } from '../data/circuitPhaseConnections';
import { CircuitPhaseConnectionDisplay } from './CircuitPhaseConnectionDisplay';
import { Circuits } from './Circuits';

function fixture() {
  const {data} = createProject();
  const board = data.boards[0];
  const first = makeDevice('breaker',[]), second = makeDevice('breaker',[first]);
  first.electrical = {role:'mcb',poles:['L']}; second.electrical = {role:'mcb',poles:['L']};
  first.boardId = board.id; second.boardId = board.id;
  data.devices.push(first,second);
  board.rows[0].placements.push({deviceId:first.id,start:0},{deviceId:second.id,start:1});
  const circuit = {id:'c1',code:'ÁK1',name:'Test',color:'#123456',notes:'',protectionDeviceId:first.id,
    boardConnections:[{boardId:board.id,terminals:[{conductor:'L' as const,endpoint:{kind:'device' as const,deviceId:second.id,side:'bottom' as const,pole:0}}]}]};
  data.circuits = [circuit];
  return {data,board,circuit,first,second};
}

describe('circuit phase connection display', () => {
  it('shows the actual connected device and not the conflicting saved manual choice', () => {
    const {data,circuit,first,second} = fixture();
    const result = getCircuitPhaseConnections(data,circuit);
    expect(result).toMatchObject([{kind:'connected',conductor:'L',endpoint:{kind:'device',deviceId:second.id}}]);
    const markup = renderToStaticMarkup(createElement(CircuitPhaseConnectionDisplay,{data,circuit}));
    expect(markup).toContain(second.code);
    expect(markup).not.toContain(`${first.code} · ${first.name}`);
    expect(markup).not.toContain('<select');
    const circuitsMarkup = renderToStaticMarkup(createElement(Circuits,{data,onChange:()=>{},onSelect:()=>{},onNewCircuitFocused:()=>{}}));
    expect(circuitsMarkup).not.toMatch(/<select[^>]*aria-label="ÁK1 védelme"/);
    expect(circuitsMarkup).toContain(second.code);
  });

  it('does not invent a device from old metadata or a neutral connection', () => {
    const {data,board,circuit,first} = fixture();
    const neutralCircuit = {...circuit,boardConnections:[{boardId:board.id,terminals:[{
      conductor:'N' as const,endpoint:{kind:'device' as const,deviceId:first.id,side:'bottom' as const,pole:0}
    }]}]};
    first.circuitId = circuit.id;
    expect(getCircuitPhaseConnections(data,neutralCircuit)).toEqual([]);
    expect(renderToStaticMarkup(createElement(CircuitPhaseConnectionDisplay,{data,circuit:neutralCircuit}))).toContain('Nincs fázisbekötés az elosztón.');
  });

  it('shows a bus connection without pretending it identifies an overcurrent protective device', () => {
    const {data,board,circuit} = fixture();
    board.wiring = {buses:[{id:'phase-bus',name:'Fázissín',conductor:'L',capacity:2,position:'top',terminalLabels:['','']}],wires:[],infeeds:[]};
    const connected = {...circuit,boardConnections:[{boardId:board.id,terminals:[{
      conductor:'L' as const,endpoint:{kind:'bus' as const,busId:'phase-bus',terminal:0}
    }]}]};
    const markup = renderToStaticMarkup(createElement(CircuitPhaseConnectionDisplay,{data,circuit:connected}));
    expect(markup).toContain('Fázissín');
    expect(markup).toContain('A túláramvédelmi készülék ebből a közvetlen bekötésből nem állapítható meg.');
  });

  it('retains hidden connections, different boards and unresolved legacy alternatives', () => {
    const {data,board,circuit,first,second} = fixture();
    const other = {...structuredClone(board),id:'b2',name:'Másik elosztó'}; data.boards.push(other);
    const connections = [
      {...circuit.boardConnections[0],hidden:true},
      {boardId:other.id,terminals:[],legacyTerminalConflicts:[{conductor:'L1' as const,endpoints:[
        {kind:'device' as const,deviceId:first.id,side:'top' as const,pole:0},
        {kind:'device' as const,deviceId:second.id,side:'top' as const,pole:0}
      ]}]}
    ];
    const updated = {...circuit,boardConnections:connections};
    const result = getCircuitPhaseConnections(data,updated);
    expect(result).toMatchObject([{kind:'connected',boardId:board.id},{kind:'unresolved',boardId:other.id,conductor:'L1'}]);
    const markup = renderToStaticMarkup(createElement(CircuitPhaseConnectionDisplay,{data,circuit:updated}));
    expect(markup).toContain('Korábbi fázisbekötés tisztázandó az elosztón.');
    expect(markup).toContain('Másik elosztó');
  });
});
