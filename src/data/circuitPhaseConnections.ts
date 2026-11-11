import type { Circuit, Conductor, ProjectData, WiringEndpoint } from '../types';

/** A current cabinet connection, or an old ambiguous connection still awaiting a decision. */
export type CircuitPhaseConnection =
  | { kind: 'connected'; boardId: string; conductor: Conductor; endpoint: WiringEndpoint }
  | { kind: 'unresolved'; boardId: string; conductor: Conductor; conflictingEndpoints: WiringEndpoint[] };

const phaseConductors = new Set<Conductor>(['L', 'L1', 'L2', 'L3']);

/**
 * Read the circuit's actual phase terminal assignments, including hidden circuit
 * boxes. Old manual protection metadata and device ownership are not evidence
 * of a circuit connection. Keep ambiguous historical alternatives explicit.
 */
export function getCircuitPhaseConnections(data: ProjectData, circuit: Circuit): CircuitPhaseConnection[] {
  const boardIds = new Set(data.boards.map(board => board.id));
  return (circuit.boardConnections ?? []).flatMap(connection => {
    if (!boardIds.has(connection.boardId)) return [];
    const terminals: CircuitPhaseConnection[] = connection.terminals
      .filter(item => phaseConductors.has(item.conductor))
      .map(item => ({kind:'connected',boardId:connection.boardId,conductor:item.conductor,endpoint:item.endpoint}));
    const unresolved: CircuitPhaseConnection[] = (connection.legacyTerminalConflicts ?? [])
      .filter(item => phaseConductors.has(item.conductor))
      .map(item => ({kind:'unresolved',boardId:connection.boardId,conductor:item.conductor,conflictingEndpoints:item.endpoints}));
    return [...terminals,...unresolved];
  });
}
