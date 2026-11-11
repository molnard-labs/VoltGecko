import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { decodeProject, encodeProject, validateProject } from './archive';
import { pruneInvalidBoardRouteTerminals } from './boardRouteConnections';
import { checkpoint, createProject, deleteBoard, restoreRevision } from './project';

function fixture() {
  const doc = createProject('Terv');
  const first = doc.data.boards[0];
  const second = { ...structuredClone(first), id:'second-board', name:'Műhely', rows:[] };
  const third = { ...structuredClone(first), id:'third-board', name:'Melléképület', rows:[] };
  doc.data.boards.push(second, third);
  const sheet = doc.data.sheets[0];
  sheet.boardPlacements = [first, second, third].map((board, index) => ({ boardId:board.id, x:index * 100, y:100 }));
  sheet.routes = [{ id:'r', fromBoardId:first.id, toBoardId:second.id, kind:'power', points:[], boardPositions:[
    { boardId:first.id, x:25, y:420 }, { boardId:second.id, x:700, y:660 }
  ] }];
  return { doc, first, second, third };
}

describe('independent board route positions', () => {
  it('round-trips separate board positions, preserves revisions and accepts old routes', async () => {
    const {doc, first} = fixture();
    const saved = checkpoint(doc, 'Pozíciók');
    const reopened = await decodeProject(await encodeProject(saved));
    expect(reopened.data.sheets[0].routes[0].boardPositions).toEqual(doc.data.sheets[0].routes[0].boardPositions);
    const removed = { ...reopened, data:deleteBoard(reopened.data, first.id) };
    expect(removed.data.sheets[0].routes).toHaveLength(0);
    const restored = restoreRevision(removed, reopened.revisions[0].id);
    expect(restored.data.sheets[0].routes[0].boardPositions).toEqual(doc.data.sheets[0].routes[0].boardPositions);
    expect(() => validateProject(restored)).not.toThrow();
    delete doc.data.sheets[0].routes[0].boardPositions;
    expect(() => validateProject(doc)).not.toThrow();
  });

  it('prunes the detached board position while preserving the other one', () => {
    const {doc,first,second} = fixture();
    const outlet = makeDevice('outlet', []);
    doc.data.devices.push(outlet);
    doc.data.sheets[0].placements.push({deviceId:outlet.id, x:20, y:30, rotation:0});
    const route = doc.data.sheets[0].routes[0];
    delete route.toBoardId;
    route.toDeviceId = outlet.id;
    const cleaned = pruneInvalidBoardRouteTerminals(doc.data);
    expect(cleaned.sheets[0].routes[0].boardPositions).toEqual([{boardId:first.id,x:25,y:420}]);
    expect(route.boardPositions?.some(position => position.boardId === second.id)).toBe(true);
    expect(() => validateProject({...doc,data:cleaned})).not.toThrow();
  });

  it('rejects duplicate, unrelated and invalid coordinate positions', () => {
    const {doc,first,third} = fixture();
    const duplicated = structuredClone(doc);
    duplicated.data.sheets[0].routes[0].boardPositions![1].boardId = first.id;
    expect(() => validateProject(duplicated)).toThrow();
    const unrelated = structuredClone(doc);
    unrelated.data.sheets[0].routes[0].boardPositions![1].boardId = third.id;
    expect(() => validateProject(unrelated)).toThrow();
    const invalid = structuredClone(doc);
    invalid.data.sheets[0].routes[0].boardPositions![0].x = Number.NaN;
    expect(() => validateProject(invalid)).toThrow();
  });
});
