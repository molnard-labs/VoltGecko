import type { Circuit, Conductor, Phase, ProjectData } from '../types';
import { circuitBelongsToBoard } from './circuitBoardAssociation';

/** Stable display order; does not imply a physical terminal order. */
export const conductorOrder: Conductor[] = ['L', 'L1', 'L2', 'L3', 'N', 'PE', 'PEN'];
const phases = new Set<Conductor>(['L', 'L1', 'L2', 'L3']);
const ordered = (values: Iterable<Conductor>): Conductor[] => {
  const set = new Set(values);
  return conductorOrder.filter(value => set.has(value));
};

/** Existing physical terminal assignments must remain visible and intact. */
export function recordedCircuitConductors(circuit: Circuit): Conductor[] {
  return ordered((circuit.boardConnections ?? []).flatMap(connection => [
    ...connection.terminals.map(terminal => terminal.conductor),
    ...(connection.legacyTerminalConflicts ?? []).map(conflict => conflict.conductor),
  ]));
}

/** An undefined list is a legacy project; never infer functions from core count. */
export function selectedCircuitConductors(circuit: Circuit): Conductor[] {
  return ordered([
    ...(circuit.conductors ?? (circuit.phase ? [circuit.phase] : [])),
    ...recordedCircuitConductors(circuit),
  ]);
}

/** Only offer conductors explicitly configured in this circuit's board feeds.
 * A separate earth infeed can provide PE/PEN. Unknown supplies do not imply
 * single- or three-phase wiring. */
export function availableCircuitConductors(data: ProjectData, circuit: Circuit): Conductor[] {
  return ordered(data.boards.filter(board => circuitBelongsToBoard(data, circuit, board.id)).flatMap(board =>
    (board.wiring?.infeeds ?? []).flatMap(infeed => infeed.kind === 'supply'
      ? infeed.poles : infeed.poles.filter(pole => pole === 'PE' || pole === 'PEN'))
  ));
}

function withSelection(data: ProjectData, circuit: Circuit, next: Conductor[]): ProjectData {
  const selectedPhases = next.filter(item => phases.has(item));
  const replacement: Circuit = {...circuit, conductors: next};
  if (selectedPhases.length === 1) replacement.phase = selectedPhases[0] as Phase;
  else delete replacement.phase;
  return {...data, circuits: data.circuits.map(item => item.id === circuit.id ? replacement : item)};
}

/** Persist an explicitly reviewed legacy selection without changing any wire. */
export function confirmCircuitConductors(data: ProjectData, circuitId: string): ProjectData {
  const circuit = data.circuits.find(item => item.id === circuitId);
  if (!circuit || circuit.conductors !== undefined) return data;
  return withSelection(data,circuit,selectedCircuitConductors(circuit));
}

/** Resolve an explicitly selected list that predates a saved connection.
 * This operation is always user-triggered and changes no physical connection. */
export function includeRecordedCircuitConductors(data: ProjectData, circuitId: string): ProjectData {
  const circuit = data.circuits.find(item => item.id === circuitId);
  if (!circuit || !circuit.conductors || recordedCircuitConductors(circuit).every(value => circuit.conductors!.includes(value))) return data;
  return withSelection(data,circuit,selectedCircuitConductors(circuit));
}

/** Change the declared conductors without ever removing a terminal or its
 * wire. A connected (or unresolved legacy) conductor must first be detached
 * in the cabinet. Selection does not invent or assign physical connections. */
export function setCircuitConductor(data: ProjectData, circuitId: string, conductor: Conductor, checked: boolean): ProjectData {
  const circuit = data.circuits.find(item => item.id === circuitId);
  if (!circuit) return data;
  const selected = selectedCircuitConductors(circuit);
  if (circuit.conductors !== undefined && recordedCircuitConductors(circuit).some(item=>!circuit.conductors!.includes(item))) return data;
  if (checked === selected.includes(conductor)) return data;
  if (!checked && recordedCircuitConductors(circuit).includes(conductor)) return data;
  if (checked && !availableCircuitConductors(data, circuit).includes(conductor)) return data;
  const next = ordered(checked ? [...selected, conductor] : selected.filter(item => item !== conductor));
  return withSelection(data,circuit,next);
}
