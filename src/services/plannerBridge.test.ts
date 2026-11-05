import { describe, expect, it } from 'vitest';
import { createProject, checkpoint } from '../data/project';
import { decodeProject, encodeProject } from '../data/archive';
import type { BoardPlannerSnapshot, Circuit, ProjectData } from '../types';
import { applyBoardPlannerSnapshot, isBoardPlannerSnapshot } from './plannerBridge';

const fixture = (): BoardPlannerSnapshot => ({
  v: 3, rev: 9, project: { name: 'Elosztó' }, boxes: [{ name: 'Elosztó' }],
  rows: [{ mods: 18, box: 0 }], comps: [{ id: 'c1', type: 'mcb', poles: '1P', row: 0, x: 0, name: 'Fény', cable: 'NYM-J', power: 100, phase: 'L1', loadType: 'lamp' }],
  wires: [], bw: [], bb: [], stubs: [], nid: 2, lo: {}
});
const shared = (): Circuit => ({ id: 'circuit-1', code: 'ÁK1', name: 'Meglévő', color: '#123456', notes: 'Maradjon', cable: 'Régi', powerW: 1000, phase: 'L2' });

describe('board planner project bridge', () => {
  it('does not overwrite existing circuit data when a new or imported link first appears', () => {
    const data = createProject().data; data.circuits = [shared()];
    const board = fixture(); board.comps[0].vgCircuitId = 'circuit-1';
    const result = applyBoardPlannerSnapshot(data, board);
    expect(result.circuits).toEqual([shared()]);
    expect(result.boardPlanner?.comps[0].vgCircuitId).toBe('circuit-1');
    expect(data.boardPlanner).toBeUndefined();
  });
  it('updates only a previously linked circuit and retains floor-plan associations', () => {
    const doc = createProject(); const original = shared(); doc.data.circuits = [original];
    const board = fixture(); board.comps[0].vgCircuitId = original.id;
    doc.data.boardPlanner = structuredClone(board);
    const edited = structuredClone(board); edited.comps[0].name = 'Új név'; edited.comps[0].power = 2300;
    const next = applyBoardPlannerSnapshot(doc.data, edited);
    expect(next.circuits[0]).toMatchObject({ id: original.id, code: original.code, name: 'Új név', notes: original.notes, color: original.color, powerW: 2300 });
    expect(next.sheets).toBe(doc.data.sheets);
    expect(next.devices).toBe(doc.data.devices);
    expect(doc.data.circuits[0]).toEqual(original);
  });
  it('does not overwrite a newer circuit edit with a queued geometry-only board snapshot', () => {
    const data = createProject().data;
    const board = fixture(); board.comps[0].vgCircuitId = 'circuit-1';
    data.boardPlanner = structuredClone(board);
    data.circuits = [{ ...shared(), name:'Újabb külső név', cable:'Másik kábel', powerW:4300 }];
    const moved = structuredClone(board); moved.comps[0].x = 3;
    const next = applyBoardPlannerSnapshot(data, moved);
    expect(next.circuits).toEqual(data.circuits);
    expect(next.boardPlanner?.comps[0].x).toBe(3);
    const edited = structuredClone(moved); edited.comps[0].power = 600;
    const simultaneous = applyBoardPlannerSnapshot(next, edited);
    expect(simultaneous.circuits[0]).toMatchObject({ name:'Újabb külső név', cable:'Másik kábel', powerW:600 });
  });
  it('creates a circuit only after an explicit request and never removes an existing one', () => {
    const data: ProjectData = createProject().data; data.circuits = [shared()];
    const board = fixture(); board.comps[0].vgCircuitId = 'vgp-new';
    expect(applyBoardPlannerSnapshot(data, board).circuits).toEqual([shared()]);
    board.comps[0].vgCreate = true;
    const added = applyBoardPlannerSnapshot(data, board);
    expect(added.circuits).toHaveLength(2);
    expect(added.circuits[1]).toMatchObject({ id: 'vgp-new', name: 'Fény', powerW: 100, phase: 'L1' });
    const removedBoard = structuredClone(board); removedBoard.comps = [];
    expect(applyBoardPlannerSnapshot(added, removedBoard).circuits).toEqual(added.circuits);
  });
  it('round-trips complete board snapshots and saved revisions in vgecko archives', async () => {
    const doc = createProject(); doc.data.boardPlanner = fixture();
    const saved = checkpoint(doc, 'Első terv');
    saved.data = structuredClone(saved.data);
    saved.data.boardPlanner!.comps[0].name = 'Friss terv';
    const reopened = await decodeProject(await encodeProject(saved));
    expect(reopened.data.boardPlanner?.comps[0].name).toBe('Friss terv');
    expect(reopened.revisions[0].data.boardPlanner?.comps[0].name).toBe('Fény');
  });
  it('rejects invalid and excessive embedded snapshots at the archive boundary', async () => {
    const board = fixture(); board.comps[0].id = 'bad" onpointerenter="x';
    expect(isBoardPlannerSnapshot(board)).toBe(false);
    const doc = createProject(); doc.data.boardPlanner = board;
    await expect(encodeProject(doc)).rejects.toThrow('elosztóterv');
    const large = fixture(); large.project.notes = 'x'.repeat(8_000_001);
    expect(isBoardPlannerSnapshot(large)).toBe(false);
  });
});
