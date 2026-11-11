import { afterEach, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject } from '../data/project';
import { setLanguage } from '../i18n';
import { circuitPhaseConnectionLabel } from './circuitPhaseLabels';
import type { Circuit } from '../types';

afterEach(() => setLanguage('hu'));

it('reports the actual hidden board terminal, never the old manual protection', () => {
  const {data} = createProject('Project'), board = data.boards[0];
  const old = makeDevice('breaker', []), actual = makeDevice('breaker', [old]);
  old.electrical = {poles:['L']}; actual.electrical = {poles:['L']};
  data.devices.push(old,actual);
  const circuit:Circuit = {id:'c',code:'C',name:'Circuit',notes:'',color:'#123456',protectionDeviceId:old.id,boardConnections:[{
    boardId:board.id,hidden:true,terminals:[{conductor:'L',endpoint:{kind:'device',deviceId:actual.id,side:'bottom',pole:0}}],
  }]};
  expect(circuitPhaseConnectionLabel(data,circuit)).toBe(`L · ${actual.code} · alsó 1 (L)`);
  circuit.boardConnections![0].terminals = [];
  expect(circuitPhaseConnectionLabel(data,circuit)).toBe('Nincs fázisbekötés');
  setLanguage('en');
  expect(circuitPhaseConnectionLabel(data,circuit)).toBe('No phase terminal connected');
});

it('identifies board and real bus terminals and marks unresolved legacy candidates', () => {
  const {data} = createProject('Project'), board = data.boards[0];
  const second = {...structuredClone(board), id:'second',name:'Műhely'};
  data.boards.push(second);
  board.wiring = {infeeds:[],wires:[],buses:[{id:'phase-bus',name:'Fázissín',conductor:'L',position:'bottom',capacity:2,terminalLabels:[]}]};
  const old = makeDevice('breaker', []), other = makeDevice('breaker', [old]);
  old.electrical = {poles:['L']}; other.electrical = {poles:['L']};
  data.devices.push(old,other);
  const a = {kind:'device' as const,deviceId:old.id,side:'top' as const,pole:0};
  const b = {kind:'device' as const,deviceId:other.id,side:'top' as const,pole:0};
  const circuit:Circuit = {id:'c',code:'C',name:'Circuit',notes:'',color:'#123456',boardConnections:[
    {boardId:board.id,terminals:[{conductor:'L',endpoint:{kind:'bus',busId:'phase-bus',terminal:1}}]},
    {boardId:second.id,terminals:[],legacyTerminalConflicts:[{conductor:'L',endpoints:[a,b]}]},
  ]};
  const label = circuitPhaseConnectionLabel(data,circuit);
  expect(label).toContain(`${board.name} · L · Fázissín · 2 (L)`);
  expect(label).toContain('Műhely · L · Ellenőrizendő:');
  expect(label).toContain(old.code); expect(label).toContain(other.code);
  expect(circuitPhaseConnectionLabel(data,circuit,board.id)).not.toContain('Műhely');
});
