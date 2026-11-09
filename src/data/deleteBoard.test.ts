import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { decodeProject, encodeProject } from './archive';
import { createProject, deleteBoard } from './project';
import type { BoardWire } from '../types';

describe('deleteBoard', () => {
  it('keeps devices and surviving wiring, removes cross-board references to deleted buses and infeeds, and round-trips', async () => {
    const doc = createProject('Board deletion');
    const deleted = doc.data.boards[0];
    doc.data.sheets[0].boardPlacements = [{boardId:deleted.id, x:50, y:70}, {boardId:'keep-board',x:80,y:100}];
    const device = makeDevice('breaker', []);
    device.boardId = deleted.id;
    doc.data.devices.push(device);
    deleted.rows[0].placements.push({ deviceId: device.id, start: 0 });
    deleted.wiring = {
      buses: [{ id: 'bus', name: 'N', conductor: 'N', capacity: 1, position: 'bottom', terminalLabels: [] }],
      infeeds: [{ id: 'source', name: 'Supply', kind: 'supply', poles: ['L'] }],
      wires: []
    };
    const end = {kind: 'device', deviceId: device.id, side: 'top', pole: 0} as const;
    const wires: BoardWire[] = [
      {id:'bus-wire', from:{kind:'bus',busId:'bus',terminal:0},to:end},
      {id:'source-wire', from:{kind:'infeed',infeedId:'source',pole:0},to:end},
      {id:'remaining-wire', from:end,to:{kind:'bus',busId:'keep-bus',terminal:0}}
    ];
    doc.data.boards.push({id:'keep-board',name:'Other',rows:[],wiring:{buses:[{id:'keep-bus',name:'L',conductor:'L',capacity:1,position:'top',terminalLabels:[]}],infeeds:[],wires}});
    const before = structuredClone(doc.data);
    const next = deleteBoard(doc.data, deleted.id);
    expect(doc.data).toEqual(before);
    expect(next.boards.map(board => board.id)).toEqual(['keep-board']);
    expect(next.sheets[0].boardPlacements).toEqual([{boardId:'keep-board',x:80,y:100}]);
    expect(next.devices[0].id).toBe(device.id);
    expect(next.devices[0].boardId).toBeUndefined();
    expect(next.boards[0].wiring?.wires.map(wire => wire.id)).toEqual(['remaining-wire']);
    const reopened = await decodeProject(await encodeProject({...doc, data: next}));
    expect(reopened.data).toEqual(next);
  });

  it('allows deleting and saving the final board and ignores a missing board', async () => {
    const doc = createProject('Empty');
    const data = doc.data;
    expect(deleteBoard(data, 'missing')).toBe(data);
    const next = deleteBoard(data, data.boards[0].id);
    expect(next.boards).toEqual([]);
    expect((await decodeProject(await encodeProject({...doc, data: next}))).data.boards).toEqual([]);
  });
});
