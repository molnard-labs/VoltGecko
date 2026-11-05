import type { BoardPlannerSnapshot, Circuit, Phase, ProjectData } from '../types';

const MAX_SNAPSHOT_LENGTH = 8_000_000;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedArray = (value: unknown, max: number): value is unknown[] => Array.isArray(value) && value.length <= max;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const circuitId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\x00-\x1f\x7f]/.test(value);

/** Keep the standalone editor's representation intact, but reject malformed and oversized snapshots. */
export function isBoardPlannerSnapshot(value: unknown): value is BoardPlannerSnapshot {
  if (!object(value) || value.v !== 3 || typeof value.rev !== 'number' || !Number.isInteger(value.rev) || value.rev < 0 || value.rev > 9 || !object(value.project)) return false;
  if (!boundedArray(value.boxes, 8) || !boundedArray(value.rows, 40) || !boundedArray(value.comps, 20000) || !boundedArray(value.wires, 50000) || !boundedArray(value.bw, 50000) || !boundedArray(value.bb, 50000) || !boundedArray(value.stubs, 50000)) return false;
  if (!value.rows.length || typeof value.nid !== 'number' || !Number.isSafeInteger(value.nid) || value.nid < 0) return false;
  if (value.lo !== undefined && !object(value.lo)) return false;
  if (!(value.comps as unknown[]).every(c => object(c) && safeId(c.id) && typeof c.type === 'string' && typeof c.poles === 'string' && (c.vgCircuitId === undefined || circuitId(c.vgCircuitId)))) return false;
  for (const list of [value.wires, value.bw, value.bb, value.stubs] as unknown[][]) {
    if (!list.every(item => object(item) && safeId(item.id))) return false;
  }
  try { return JSON.stringify(value).length <= MAX_SNAPSHOT_LENGTH; } catch { return false; }
}

const loads = new Set(['socket', 'lamp', 'motor', 'other']);
const phases = new Set(['L1', 'L2', 'L3']);
const stringField = (v: unknown, limit: number) => typeof v === 'string' ? v.slice(0, limit) : '';
const powerValue = (v: unknown) => {
  if (v === '' || v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? n : undefined;
};
const color = ['#2d7d67', '#c29238', '#7286bc', '#c57363', '#8b72a6'];

/**
 * Merge only explicitly linked load devices. Floor-plan devices, routes, notes,
 * colours and existing circuit identities are never replaced or deleted.
 */
export function applyBoardPlannerSnapshot(data: ProjectData, snapshot: unknown): ProjectData {
  if (!isBoardPlannerSnapshot(snapshot)) throw new Error('Érvénytelen elosztóterv.');
  const copy = structuredClone(snapshot);
  let circuits = data.circuits;
  const assigned = new Set<string>();
  for (const comp of copy.comps) {
    const id = comp.vgCircuitId;
    if (!circuitId(id) || !['mcb', 'rcbo', 'contactor', 'mpcb', 'outlet'].includes(String(comp.type)) || assigned.has(id)) continue;
    assigned.add(id);
    const existing = circuits.find(circuit => circuit.id === id);
    if (!existing && !(comp.vgCreate === true && id.startsWith('vgp-'))) continue;
    // A newly created link (including one in an imported JSON file) must not
    // overwrite an existing shared circuit with the device's stale defaults.
    // The child initializes that device from the shared circuit first.
    const previous = data.boardPlanner?.comps.find(item => item.id === comp.id);
    if (existing && previous?.vgCircuitId !== id) continue;
    let circuit: Circuit;
    if (existing) circuit = { ...existing };
    else {
      let n = 1;
      while (circuits.some(item => item.code === `ÁK${n}`)) n++;
      circuit = { id, code: `ÁK${n}`, name: '', color: color[circuits.length % color.length], notes: '' };
    }
    // An old drawing update may arrive after another view edited the shared
    // circuit. Merge only fields this editor actually changed since its prior
    // snapshot; geometry-only updates must not restore stale circuit values.
    const changed = (key: string) => !existing || (previous?.[key] ?? '') !== (comp[key] ?? '');
    if (changed('name')) circuit.name = typeof comp.name === 'string' ? comp.name.slice(0, 100_000) : circuit.name || 'Új áramkör';
    if (changed('cable')) circuit.cable = stringField(comp.cable, 5000) || undefined;
    if (changed('power')) circuit.powerW = powerValue(comp.power);
    if (changed('phase')) circuit.phase = phases.has(String(comp.phase)) ? comp.phase as Phase : undefined;
    if (changed('loadType')) circuit.loadType = loads.has(String(comp.loadType)) ? comp.loadType as Circuit['loadType'] : undefined;
    if (!existing || JSON.stringify(existing) !== JSON.stringify(circuit)) {
      if (circuits === data.circuits) circuits = [...circuits];
      if (existing) circuits[circuits.findIndex(item => item.id === id)] = circuit;
      else circuits.push(circuit);
    }
  }
  return { ...data, circuits, boardPlanner: copy };
}
