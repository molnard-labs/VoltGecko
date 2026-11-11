import type { Circuit, Conductor } from '../types';

/** Visible circuit terminals: a declared conductor list limits new connector
 * choices, but every existing connection remains accessible even if older
 * data disagrees with the declaration. An undefined list preserves the
 * previous project's connector choices; [] is an intentional empty list. */
export function visibleCircuitConnectors(
  circuit: Circuit,
  legacyCandidates: readonly Conductor[],
  connections: readonly { conductor: Conductor }[]
): Conductor[] {
  const candidates = [...new Set(circuit.conductors ?? legacyCandidates)];
  for (const connection of connections)
    if (!candidates.includes(connection.conductor)) candidates.push(connection.conductor);
  return candidates;
}
