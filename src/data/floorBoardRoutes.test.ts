import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { Route } from '../types';
import { decodeProject, encodeProject, validateProject } from './archive';
import { checkpoint, createProject, deleteBoard, deleteDevice, restoreRevision } from './project';

function fixture() {
  const doc = createProject('Board routes');
  const board = doc.data.boards[0];
  const secondBoard = {...structuredClone(board), id:'second-board'};
  doc.data.boards.push(secondBoard);
  const first = {...makeDevice('outlet', []), id:'first'};
  const second = {...makeDevice('light', [first]), id:'second'};
  doc.data.devices = [first, second];
  const sheet = doc.data.sheets[0];
  sheet.boardPlacements = [{boardId:board.id,x:10,y:20},{boardId:secondBoard.id,x:30,y:40}];
  sheet.placements = [{deviceId:first.id,x:50,y:60,rotation:0},{deviceId:second.id,x:70,y:80,rotation:0}];
  sheet.routes = [
    {id:'board-first',fromBoardId:board.id,toDeviceId:first.id,kind:'power',points:[{x:25,y:20}]},
    {id:'second-board',fromDeviceId:second.id,toBoardId:board.id,kind:'control',points:[]},
    {id:'boards',fromBoardId:board.id,toBoardId:secondBoard.id,kind:'power',points:[]},
    {id:'devices',fromDeviceId:first.id,toDeviceId:second.id,kind:'power',points:[]}
  ];
  return {doc,board,secondBoard,first,second};
}

describe('floor-plan board route storage', () => {
  it('round-trips all endpoint combinations and restores them from history after board deletion', async () => {
    const {doc,board} = fixture();
    expect(() => validateProject(doc)).not.toThrow();
    const saved = checkpoint(doc, 'Before deleting board');
    const removed = {...saved,data:deleteBoard(saved.data,board.id)};
    expect(removed.data.sheets[0].routes.map(route => route.id)).toEqual(['devices']);
    expect(removed.data.sheets[0].boardPlacements?.map(item => item.boardId)).toEqual(['second-board']);
    expect(() => validateProject(removed)).not.toThrow();
    const reopened = await decodeProject(await encodeProject(removed));
    const restored = restoreRevision(reopened,reopened.revisions[0].id);
    expect(restored.data.sheets[0].routes).toEqual(doc.data.sheets[0].routes);
    expect(() => validateProject(restored)).not.toThrow();
  });
  it('removes only routes referencing a deleted device', () => {
    const {doc,first} = fixture();
    const removed = deleteDevice(doc.data,first.id);
    expect(removed.sheets[0].routes.map(route => route.id)).toEqual(['second-board','boards']);
    expect(() => validateProject({...doc,data:removed})).not.toThrow();
  });
  it('keeps device routes when a board shares the same ID', () => {
    const {doc,board,first} = fixture();
    const oldBoardId = board.id;
    board.id = first.id;
    const sheet = doc.data.sheets[0];
    sheet.boardPlacements![0].boardId = first.id;
    for (const route of sheet.routes) {
      if (route.fromBoardId === oldBoardId) route.fromBoardId = first.id;
      if (route.toBoardId === oldBoardId) route.toBoardId = first.id;
    }
    expect(() => validateProject(doc)).not.toThrow();
    const removed = deleteBoard(doc.data,first.id);
    expect(removed.sheets[0].routes.map(route => route.id)).toEqual(['devices']);
    expect(removed.devices.some(device => device.id === first.id)).toBe(true);
    expect(() => validateProject({...doc,data:removed})).not.toThrow();
  });
  it('rejects missing, ambiguous, unknown and unplaced board endpoints', () => {
    const {doc,board,first} = fixture();
    const base = doc.data.sheets[0].routes[0];
    const invalid: Route[] = [
      {...base,fromBoardId:undefined},
      {...base,fromDeviceId:first.id},
      {...base,fromBoardId:'unknown'},
      {...base,toBoardId:board.id},
    ];
    for (const route of invalid) {
      const copy = structuredClone(doc);
      copy.data.sheets[0].routes = [route];
      expect(() => validateProject(copy)).toThrow();
    }
    const unplaced = structuredClone(doc);
    unplaced.data.sheets[0].boardPlacements = [];
    expect(() => validateProject(unplaced)).toThrow();
  });
});
