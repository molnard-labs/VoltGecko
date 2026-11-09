import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { BoardWire, WiringEndpoint } from '../types';
import { decodeProject, encodeProject } from './archive';
import { balanceUnassignedPhases, effectiveDevicePoles, endpointConductor, estimateVoltageDrop, getPhaseLoads, getWiringIssues, wiringEndpointLabel } from './boardWiring';
import { checkpoint, createProject, deleteDevice, restoreRevision } from './project';

const d = (deviceId: string, pole = 0, side: 'top' | 'bottom' = 'top'): WiringEndpoint => ({ kind: 'device', deviceId, pole, side });
const b = (busId: string, terminal = 0): WiringEndpoint => ({ kind: 'bus', busId, terminal });
const i = (infeedId: string, pole = 0): WiringEndpoint => ({ kind: 'infeed', infeedId, pole });
const w = (id: string, from: WiringEndpoint, to: WiringEndpoint): BoardWire => ({ id, from, to });
function fixture() {
  const doc = createProject('Detailed wiring');
  doc.data.devices = ['a', 'b', 'c'].map(id => ({ ...makeDevice('breaker', []), id, code: id.toUpperCase(), electrical: { poles: ['L', 'N'] } }));
  const board = doc.data.boards[0]; board.rows[0].placements = doc.data.devices.map((device, start) => ({ deviceId: device.id, start }));
  board.wiring = { buses: [{ id: 'phase', name: 'Phase bus', conductor: 'L1', capacity: 12, position: 'bottom', terminalLabels: ['Input'] }, { id: 'earth', name: 'Earth bus', conductor: 'PE', capacity: 12, position: 'bottom', terminalLabels: [] }], infeeds: [{ id: 'supply', name: 'Supply', kind: 'supply', poles: ['L1', 'N'] }, { id: 'earth-electrode', name: 'Earth', kind: 'earth', poles: ['PE'] }], wires: [] };
  return { doc, board, wiring: board.wiring };
}
describe('detailed wiring documentation', () => {
  it('preserves the incoming supply rating in the project archive', async () => {
    const { doc, wiring } = fixture();
    wiring.infeeds[0].currentA = 16;
    const loaded = await decodeProject(await encodeProject(doc));
    expect(loaded.data.boards[0].wiring?.infeeds[0].currentA).toBe(16);
  });
  it('derives poles from manufacturer counts instead of confusing module width with poles', () => {
    const device = makeDevice('breaker', []); device.moduleWidth = 4;
    expect(effectiveDevicePoles(device)).toEqual(['L']);
    device.product = { poles: '3P+N' } as never;
    expect(effectiveDevicePoles(device)).toEqual(['L1', 'L2', 'L3', 'N']);
    device.electrical = { poles: ['PE'] };
    expect(effectiveDevicePoles(device)).toEqual(['PE']);
  });

  it('keeps pole selection symmetric, tracks feed through either side, and keeps earth separate', () => {
    const { doc, board, wiring } = fixture();
    wiring.wires = [w('a', i('supply', 0), d('a', 0)), w('b', d('a', 0, 'bottom'), b('phase')), w('earth', i('earth-electrode'), b('earth'))];
    expect(getWiringIssues(doc.data, board)).toEqual([]);
    wiring.wires = wiring.wires.map(wire => ({ ...wire, from: wire.to, to: wire.from })).reverse();
    expect(getWiringIssues(doc.data, board)).toEqual([]);
    expect(endpointConductor(doc.data, d('a', 1, 'bottom'))).toBe('N');
    expect(wiringEndpointLabel(doc.data, d('a', 1, 'bottom'))).toContain('2 (N)');
    wiring.wires = [w('phase', b('phase'), d('a', 0)), w('earth', i('earth-electrode'), b('earth'))];
    expect(getWiringIssues(doc.data, board)).toContainEqual(expect.objectContaining({ code: 'no-feed', busId: 'phase' }));
  });

  it('reports undirected cycles in disconnected conductor components without merging different poles', () => {
    const { doc, board, wiring } = fixture();
    wiring.wires = [w('a', d('a', 0), d('b', 0)), w('b', d('b', 0, 'bottom'), d('c', 0)), w('c', d('c', 0, 'bottom'), d('a', 0, 'bottom'))];
    const before = structuredClone(doc);
    expect(getWiringIssues(doc.data, board).filter(issue => issue.code === 'cycle')).toHaveLength(1);
    expect(doc).toEqual(before);
    wiring.wires[2].to = d('a', 1);
    expect(getWiringIssues(doc.data, board).some(issue => issue.code === 'cycle')).toBe(false);
    expect(getWiringIssues(doc.data, board)).toContainEqual(expect.objectContaining({ code: 'conductor', wireId: 'c' }));
  });

  it('follows explicitly common terminal screws without merging unrelated poles of the same conductor', () => {
    const { doc, board, wiring } = fixture();
    doc.data.devices[0].electrical = { poles: ['L', 'L'], commonPoleGroups: [[0, 1]], role: 'terminal' };
    wiring.wires = [w('in', i('supply'), d('a', 0)), w('out', d('a', 1), b('phase')), w('earth', i('earth-electrode'), b('earth'))];
    expect(getWiringIssues(doc.data, board)).toEqual([]);
    delete doc.data.devices[0].electrical.commonPoleGroups;
    expect(getWiringIssues(doc.data, board)).toContainEqual(expect.objectContaining({ code: 'no-feed', busId: 'phase' }));
  });

  it('traces a feed from another board without counting that remote board circuit load twice', () => {
    const { doc, board, wiring } = fixture();
    doc.data.devices[2].boardId = 'remote'; board.rows[0].placements = board.rows[0].placements.filter(item => item.deviceId !== 'c');
    doc.data.boards.push({ id: 'remote', name: 'Remote', rows: [{ id: 'remote-row', name: 'Remote', capacity: 4, placements: [{ deviceId: 'c', start: 0 }] }], wiring: { buses: [], infeeds: [], wires: [w('cross', i('supply'), d('c'))] } });
    wiring.wires = [w('out', d('c', 0, 'bottom'), b('phase')), w('earth', i('earth-electrode'), b('earth'))];
    expect(getWiringIssues(doc.data, board)).toEqual([]);
    doc.data.circuits.push({ id: 'remote-load', code: '', name: '', notes: '', color: '#123456', powerW: 1000, phase: 'L1', protectionDeviceId: 'c' });
    expect(getPhaseLoads(doc.data, board).totalW).toBe(0);
    expect(getPhaseLoads(doc.data, doc.data.boards[1]).totalW).toBe(1000);
  });

  it('finds phase conflicts through generic L poles and counts actual supply sources', () => {
    const { doc, board, wiring } = fixture();
    wiring.infeeds.push({ id: 'supply2', name: 'Supply 2', kind: 'supply', poles: ['L2'] });
    wiring.wires = [w('one', i('supply'), d('a')), w('two', d('a', 0, 'bottom'), i('supply2'))];
    const codes = getWiringIssues(doc.data, board).map(issue => issue.code);
    expect(codes).toContain('phase-conflict'); expect(codes).toContain('multiple-sources');
    wiring.infeeds[2].poles = ['L1'];
    expect(getWiringIssues(doc.data, board).map(issue => issue.code)).not.toContain('phase-conflict');
    expect(getWiringIssues(doc.data, board).map(issue => issue.code)).toContain('multiple-sources');
  });

  it('reports missing and out-of-range endpoints without inventing terminals', () => {
    const { doc, board, wiring } = fixture();
    wiring.wires = [w('missing', d('missing'), b('phase')), w('pole', d('a', 2), b('phase')), w('terminal', b('phase', 12), d('a'))];
    const issues = getWiringIssues(doc.data, board);
    expect(issues.filter(issue => issue.code === 'endpoint')).toHaveLength(3);
    expect(endpointConductor(doc.data, wiring.wires[1].from)).toBeUndefined();
    expect(wiringEndpointLabel(doc.data, wiring.wires[1].from)).toContain('?');
  });

  it('sums every circuit once, shares three-phase loads, preserves assigned phases while balancing', () => {
    const { doc, board } = fixture();
    doc.data.devices[1].electrical = { poles: ['L'] };
    doc.data.devices[2].electrical = { poles: ['L1', 'L2', 'L3'] };
    doc.data.circuits = [
      { id: 'fixed', code: '1', name: '', notes: '', color: '#123456', powerW: 600, phase: 'L1', protectionDeviceId: 'a' },
      { id: 'three', code: '2', name: '', notes: '', color: '#123456', powerW: 900, protectionDeviceId: 'c' },
      { id: 'large', code: '3', name: '', notes: '', color: '#123456', powerW: 500, protectionDeviceId: 'b' },
      { id: 'small', code: '4', name: '', notes: '', color: '#123456', powerW: 200, protectionDeviceId: 'b' },
    ];
    expect(getPhaseLoads(doc.data, board)).toEqual({ L1: 900, L2: 300, L3: 300, unassignedW: 700, totalW: 2200 });
    const before = structuredClone(doc.data), next = balanceUnassignedPhases(doc.data, board);
    expect(next.circuits.map(circuit => circuit.phase)).toEqual(['L1', undefined, 'L2', 'L2']);
    expect(getPhaseLoads(next, next.boards[0])).toEqual({ L1: 900, L2: 1000, L3: 300, unassignedW: 0, totalW: 2200 });
    expect(doc.data).toEqual(before);
  });

  it('fills unassigned siblings with their existing single-phase breaker assignment', () => {
    const { doc, board } = fixture();
    doc.data.devices[0].electrical = { poles: ['L'] };
    doc.data.circuits = [
      { id: 'fixed', code: '1', name: '', notes: '', color: '#123456', powerW: 600, phase: 'L3', protectionDeviceId: 'a' },
      { id: 'sibling', code: '2', name: '', notes: '', color: '#123456', powerW: 400, protectionDeviceId: 'a' },
      { id: 'other', code: '3', name: '', notes: '', color: '#123456', powerW: 900, protectionDeviceId: 'b' },
    ];
    expect(getPhaseLoads(doc.data, board)).toEqual({ L1: 0, L2: 0, L3: 1000, unassignedW: 900, totalW: 1900 });
    const next = balanceUnassignedPhases(doc.data, board);
    expect(next.circuits.map(circuit => circuit.phase)).toEqual(['L3', 'L3', 'L1']);
    expect(doc.data.circuits[1].phase).toBeUndefined();
  });

  it('retains conflicting fixed siblings and reports the physical feeder conflict without guessing', () => {
    const { doc, board } = fixture();
    doc.data.devices[0].electrical = { poles: ['L'] };
    doc.data.circuits = [
      { id: 'fixed1', code: '1', name: '', notes: '', color: '#123456', powerW: 600, phase: 'L1', protectionDeviceId: 'a' },
      { id: 'fixed2', code: '2', name: '', notes: '', color: '#123456', powerW: 400, phase: 'L2', protectionDeviceId: 'a' },
      { id: 'sibling', code: '3', name: '', notes: '', color: '#123456', powerW: 200, protectionDeviceId: 'a' },
    ];
    expect(getWiringIssues(doc.data, board)).toContainEqual(expect.objectContaining({ code: 'phase-assignment-conflict', deviceId: 'a' }));
    expect(balanceUnassignedPhases(doc.data, board).circuits).toEqual(doc.data.circuits);
    expect(getPhaseLoads(doc.data, board)).toEqual({ L1: 600, L2: 400, L3: 0, unassignedW: 200, totalW: 1200 });
  });

  it('uses associated contactor/outlet phase data and leaves their three-phase loads unbalanced', () => {
    const { doc, board } = fixture();
    doc.data.devices[0].kind = 'relay'; doc.data.devices[0].circuitId = 'contactor'; doc.data.devices[0].electrical = { role: 'contactor', poles: ['L', 'N'], phase: 'L2' };
    doc.data.devices[1].kind = 'outlet'; doc.data.devices[1].circuitId = 'outlet'; doc.data.devices[1].electrical = { role: 'outlet', poles: ['L', 'N', 'PE'], phase: 'L3' };
    doc.data.devices[2].kind = 'relay'; doc.data.devices[2].circuitId = 'three'; doc.data.devices[2].electrical = { role: 'contactor', poles: ['L1', 'L2', 'L3', 'N'] };
    doc.data.circuits = [
      { id: 'contactor', code: '1', name: '', notes: '', color: '#123456', powerW: 600 },
      { id: 'outlet', code: '2', name: '', notes: '', color: '#123456', powerW: 400 },
      { id: 'three', code: '3', name: '', notes: '', color: '#123456', powerW: 900 },
    ];
    expect(getPhaseLoads(doc.data, board)).toEqual({ L1: 300, L2: 900, L3: 700, unassignedW: 0, totalW: 1900 });
    expect(balanceUnassignedPhases(doc.data, board).circuits.map(circuit => circuit.phase)).toEqual(['L2', 'L3', undefined]);
  });

  it('only estimates resistive voltage drop with supplied manufacturer resistance and length', () => {
    expect(estimateVoltageDrop({ designation: 'Cu 2.5', crossSectionMm2: 2.5, lengthM: 20 }, 16)).toBeUndefined();
    expect(estimateVoltageDrop({ resistanceOhmPerKm: 7.41 }, 16)).toBeUndefined();
    const single = estimateVoltageDrop({ lengthM: 20, resistanceOhmPerKm: 7.41 }, 16)!;
    expect(single.volts).toBeCloseTo(4.7424); expect(single.percent).toBeCloseTo(2.0619);
    expect(estimateVoltageDrop({ lengthM: 20, resistanceOhmPerKm: 7.41 }, 16, 400, true)?.volts).toBeCloseTo(Math.sqrt(3) * 0.02 * 7.41 * 16);
    expect(estimateVoltageDrop({ lengthM: -1, resistanceOhmPerKm: 7.41 }, 16)).toBeUndefined();
  });

  it('round-trips every wire, cross-board endpoint, cable data and history while retaining loops', async () => {
    const { doc, board, wiring } = fixture();
    wiring.wires = [w('a', d('a'), d('b')), w('b', d('b'), d('c')), w('c', d('c'), d('a'))];
    wiring.wires[0] = { ...wiring.wires[0], color: '#abcdef', cable: { cores: 1, material: 'Cu', crossSectionMm2: 2.5, resistanceOhmPerKm: 7.41, lengthM: 0 }, points: [{ x: 1, y: 2 }], labelOffset: { x: -2, y: 4 } };
    doc.data.boards.push({ id: 'remote', name: 'Remote', rows: [], wiring: { buses: [], infeeds: [], wires: [w('cross', b('phase'), d('c'))] } });
    doc.data.circuits = [{ id: 'c1', code: '1', name: '', notes: '', color: '#123456', phase: 'L2', cableDetails: { cores: 5, designation: 'NYM', material: 'Cu', crossSectionMm2: 2.5, lengthM: 30 } }];
    const saved = checkpoint(doc, 'Wiring');
    const loaded = await decodeProject(await encodeProject(saved));
    expect(loaded).toEqual(saved);
    expect(getWiringIssues(loaded.data, loaded.data.boards[0]).some(issue => issue.code === 'cycle')).toBe(true);
    expect(restoreRevision(loaded, loaded.revisions[0].id).data).toEqual(doc.data);
    const deleted = deleteDevice(doc.data, 'c');
    expect(deleted.boards[0].wiring!.wires.map(wire => wire.id)).toEqual(['a']);
    expect(deleted.boards[1].wiring!.wires).toEqual([]); expect(deleted.circuits).toEqual(doc.data.circuits);
    expect(board.wiring!.wires).toHaveLength(3);
  });

  it.each(['missing', 'pole', 'terminal', 'infeed', 'role', 'phase', 'cable', 'common-overlap', 'common-range', 'common-conductor'])(
    'rejects corrupt %s in new fields including revision snapshots', async kind => {
      const { doc, wiring } = fixture(); wiring.wires = [w('a', d('a'), b('phase'))];
      const saved = checkpoint(doc, 'valid'), snapshot = saved.revisions[0].data, wire = snapshot.boards[0].wiring!.wires[0];
      if (kind === 'missing') wire.from = d('gone');
      if (kind === 'pole') wire.from = d('a', 2);
      if (kind === 'terminal') wire.to = b('phase', 12);
      if (kind === 'infeed') wire.to = i('supply', -1);
      if (kind === 'role') snapshot.devices[0].electrical!.role = 'bad' as never;
      if (kind === 'phase') snapshot.circuits.push({ id: 'bad', code: '', name: '', notes: '', color: '#123456', phase: 'L4' as never });
      if (kind === 'cable') wire.cable = { cores: 2.5 };
      if (kind === 'common-overlap') snapshot.devices[0].electrical = { poles: ['L', 'L', 'L'], commonPoleGroups: [[0, 1], [1, 2]] };
      if (kind === 'common-range') snapshot.devices[0].electrical!.commonPoleGroups = [[0, 2]];
      if (kind === 'common-conductor') snapshot.devices[0].electrical!.commonPoleGroups = [[0, 1]];
      await expect(encodeProject(saved)).rejects.toThrow('Érvénytelen projektfájl');
    },
  );

  it('requires a concrete pole for every device wire endpoint', async () => {
    const { doc, wiring } = fixture(); wiring.wires = [w('missing-pole', {kind:'device',deviceId:'a',side:'top'} as WiringEndpoint, d('b'))];
    await expect(encodeProject(doc)).rejects.toThrow('Kapocsszám');
  });
});
