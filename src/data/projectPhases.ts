import type { Phase, ProjectData } from '../types';

const allPhases: Phase[] = ['L', 'L1', 'L2', 'L3'];
const legacyPhases: Phase[] = ['L1', 'L2', 'L3'];

/** The configured supply is authoritative. With no supply, don't assume its topology. */
export function projectPhases(data: ProjectData): Phase[] {
  const configured = new Set(data.boards.flatMap(board =>
    (board.wiring?.infeeds ?? []).filter(infeed => infeed.kind === 'supply').flatMap(infeed => infeed.poles)
  ));
  const phases = allPhases.filter(phase => configured.has(phase));
  return phases.length ? phases : allPhases;
}

/** Include a previously saved value even if the current supply no longer offers it. */
export function phaseOptions(data: ProjectData, current?: Phase): Phase[] {
  const available = projectPhases(data);
  return current && !available.includes(current) ? [...available, current] : available;
}

/** Preserve legacy three-phase balancing when the supply has not been specified. */
export function balancingPhases(data: ProjectData): Phase[] {
  const hasSupply = data.boards.some(board => board.wiring?.infeeds.some(infeed =>
    infeed.kind === 'supply' && infeed.poles.some(pole => allPhases.includes(pole as Phase))));
  return hasSupply ? projectPhases(data) : legacyPhases;
}

/** Always display a saved load even if the supply was edited afterwards. */
export function loadPhases(data: ProjectData, loads: Record<Phase, number>): Phase[] {
  const available = balancingPhases(data);
  return allPhases.filter(phase => available.includes(phase) || loads[phase] !== 0);
}
