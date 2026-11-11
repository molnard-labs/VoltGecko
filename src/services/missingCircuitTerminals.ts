import type { TopologyCircuit } from '../data/boardTopology';
import type { Conductor } from '../types';

export type MissingCircuitConductor = 'L' | 'N' | 'PE';
export interface MissingCircuitTerminals {
  boardId: string;
  conductor: MissingCircuitConductor;
  circuits: string[];
}

/**
 * Report absent recorded terminal assignments, not the physical absence of a
 * conductor. Incompatible endpoints and unresolved legacy assignments are
 * reported by topology validation instead of being described as absent.
 *
 * A one-board view already receives circuits selected for that board. In a
 * multi-board view only explicit per-board associations identify ownership;
 * avoid attributing an unassigned circuit to an arbitrary cabinet.
 */
export function missingCircuitTerminals(circuits: TopologyCircuit[], selectedBoardIds: Set<string>): MissingCircuitTerminals[] {
  const boards = [...selectedBoardIds];
  const result: MissingCircuitTerminals[] = [];
  const phase = new Set<Conductor>(['L', 'L1', 'L2', 'L3']);
  for (const boardId of boards) {
    const missing: Record<MissingCircuitConductor, string[]> = { L: [], N: [], PE: [] };
    for (const item of circuits) {
      const associated = boards.length === 1 || item.circuit.boardConnections?.some(connection => connection.boardId === boardId)
        || item.connections.some(connection => connection.boardId === boardId)
        || item.unresolved.some(connection => connection.boardId === boardId);
      if (!associated) continue;
      const recorded = [
        ...item.connections.filter(connection => connection.boardId === boardId).map(connection => connection.conductor),
        ...item.unresolved.filter(connection => connection.boardId === boardId).map(connection => connection.conductor),
      ];
      if (!recorded.some(conductor => phase.has(conductor))) missing.L.push(item.circuit.code);
      if (!recorded.includes('N')) missing.N.push(item.circuit.code);
      if (!recorded.includes('PE')) missing.PE.push(item.circuit.code);
    }
    for (const conductor of ['L', 'N', 'PE'] as const) {
      if (missing[conductor].length) result.push({ boardId, conductor, circuits: missing[conductor] });
    }
  }
  return result;
}
