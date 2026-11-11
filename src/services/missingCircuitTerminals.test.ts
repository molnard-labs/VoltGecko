import { describe, expect, it } from 'vitest';
import type { TopologyCircuit, TopologyCircuitTerminal } from '../data/boardTopology';
import type { Circuit, Conductor } from '../types';
import { missingCircuitTerminals } from './missingCircuitTerminals';

function circuit(code: string, assignments: [string, Conductor, boolean?][], associations: string[] = [], unresolved: [string, Conductor][] = []): TopologyCircuit {
  return {
    circuit: { id: code, code, name: code, notes: '', color: '#000', boardConnections: associations.map(boardId => ({ boardId, terminals: [] })) } as Circuit,
    connections: assignments.map(([boardId, conductor, valid = true]) => ({ circuitId: code, boardId, conductor, valid } as TopologyCircuitTerminal)),
    unresolved: unresolved.map(([boardId, conductor]) => ({ boardId, conductor, endpoints: [] })),
  };
}

describe('missing circuit terminal summary', () => {
  it('groups only missing recorded assignments for the selected board', () => {
    const input = [
      circuit('ÁK1', [['board', 'L'], ['board', 'N']]),
      circuit('ÁK2', [['board', 'L'], ['board', 'N']]),
      circuit('ÁK5', [['board', 'N']]),
      circuit('ÁK6', []),
    ];
    const before = structuredClone(input);
    expect(missingCircuitTerminals(input, new Set(['board']))).toEqual([
      { boardId: 'board', conductor: 'L', circuits: ['ÁK5', 'ÁK6'] },
      { boardId: 'board', conductor: 'N', circuits: ['ÁK6'] },
      { boardId: 'board', conductor: 'PE', circuits: ['ÁK1', 'ÁK2', 'ÁK5', 'ÁK6'] },
    ]);
    expect(input).toEqual(before);
  });

  it('does not confuse multi-board assignments or assign an unowned circuit to every board', () => {
    const input = [
      circuit('C1', [['a', 'L'], ['a', 'N'], ['a', 'PE'], ['b', 'N']], ['a', 'b']),
      circuit('C2', [['b', 'L1'], ['b', 'N'], ['b', 'PE']], ['b']),
      circuit('Unowned', []),
    ];
    expect(missingCircuitTerminals(input, new Set(['a', 'b']))).toEqual([
      { boardId: 'b', conductor: 'L', circuits: ['C1'] },
      { boardId: 'b', conductor: 'PE', circuits: ['C1'] },
    ]);
    expect(missingCircuitTerminals(input.slice(0, 1), new Set(['a']))).toEqual([]);
  });

  it('keeps invalid or unresolved recorded connections for the separate validation warnings', () => {
    const input = [circuit('C', [['a', 'N', false], ['a', 'PE']], [], [['a', 'L2']])];
    expect(missingCircuitTerminals(input, new Set(['a']))).toEqual([]);
    expect(missingCircuitTerminals(input, new Set())).toEqual([]);
  });
});
