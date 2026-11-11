import type { TopologyCircuit } from '../data/boardTopology';
import type { Conductor } from '../types';

export type MissingCircuitConductor = Conductor;
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
    const order: Conductor[] = ['L', 'L1', 'L2', 'L3', 'N', 'PE', 'PEN'];
    const missing = new Map<Conductor, string[]>();
    for (const item of circuits) {
      const associated = boards.length === 1 || item.circuit.boardConnections?.some(connection => connection.boardId === boardId)
        || item.connections.some(connection => connection.boardId === boardId)
        || item.unresolved.some(connection => connection.boardId === boardId);
      if (!associated) continue;
      const recorded = [
        ...item.connections.filter(connection => connection.boardId === boardId).map(connection => connection.conductor),
        ...item.unresolved.filter(connection => connection.boardId === boardId).map(connection => connection.conductor),
      ];
      // A legacy circuit has no explicit selection: retain its historical
      // phase/N/PE checks. An explicitly selected list is authoritative for
      // which conductors need terminals; it may also intentionally be empty.
      const expected = item.circuit.conductors ?? ['L', 'N', 'PE'];
      for (const conductor of expected) {
        const present = item.circuit.conductors === undefined && conductor === 'L'
          ? recorded.some(value => phase.has(value)) : recorded.includes(conductor);
        if (!present) missing.set(conductor, [...(missing.get(conductor) ?? []), item.circuit.code]);
      }
    }
    for (const conductor of order) {
      const circuits = missing.get(conductor);
      if (circuits?.length) result.push({ boardId, conductor, circuits });
    }
  }
  return result;
}
