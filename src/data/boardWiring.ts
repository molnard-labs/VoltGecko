import { t } from '../i18n';
import type { Board, CableDetails, Circuit, Conductor, Device, Phase, ProjectData, WiringEndpoint } from '../types';
import { getBoardTerminalWarnings } from './boardTerminalWarnings';
import { easy9NeutralPoleCount } from '../products/easy9PoleOrder';

const phases: Phase[] = ['L1', 'L2', 'L3'];

/** Pole count comes from explicit data or manufacturer facts, never module width. */
export function effectiveDevicePoles(device: Device): Conductor[] {
  if (device.electrical) return [...device.electrical.poles];
  const description = device.product?.poles?.replace(/\s/g, '').toUpperCase();
  const count = description?.match(/^([1-4])P?(\+N)?$/);
  if (count) {
    const n = Number(count[1]);
    if (n === 4 || (n === 3 && count[2])) return ['L1', 'L2', 'L3', 'N'];
    if (n === 3) return ['L1', 'L2', 'L3'];
    if (n === 2) return count[2] ? ['L1', 'L2', 'N'] : ['L', 'N'];
    return count[2] ? ['L', 'N'] : ['L'];
  }
  if (device.kind === 'blank') return [];
  if (device.kind === 'main' || device.kind === 'rcd' || device.kind === 'rcbo') return ['L', 'N'];
  if (device.kind === 'outlet') return ['L', 'N', 'PE'];
  if (device.kind === 'spd') return ['L1', 'L2', 'L3', 'N', 'PE'];
  return ['L'];
}

// Older projects use pole indices as persistent wire identities. Reorder only
// their presentation, never those indices. Explicit physical order always wins.
/** Left-to-right logical pole indices; never changes the stored conductor identities. */
export function devicePhysicalPoleOrder(device: Device): number[] {
  const poles = effectiveDevicePoles(device);
  const identity = poles.map((_, index) => index);
  if (device.electrical?.physicalPoleOrder) return device.electrical.physicalPoleOrder;
  const isKnown = device.product?.manufacturer === 'Schneider Electric' && easy9NeutralPoleCount(device.product.reference) !== undefined;
  const isGeneric = !device.electrical && !device.product && !device.model.trim() && (device.kind === 'rcd' || device.kind === 'rcbo');
  const neutral = poles.indexOf('N');
  return (isKnown || isGeneric) && neutral > 0 ? [neutral, ...identity.filter(index => index !== neutral)] : identity;
}

/** Record an inferred non-identity order when implicit data becomes explicit. */
export function preservedPhysicalPoleOrder(device: Device): number[] | undefined {
  if (device.electrical?.physicalPoleOrder) return [...device.electrical.physicalPoleOrder];
  const order = devicePhysicalPoleOrder(device);
  return order.some((pole, index) => pole !== index) ? order : undefined;
}

function findBus(data: ProjectData, id: string) {
  return data.boards.flatMap((board) => board.wiring?.buses ?? []).find((bus) => bus.id === id);
}
function findInfeed(data: ProjectData, id: string) {
  return data.boards.flatMap((board) => board.wiring?.infeeds ?? []).find((infeed) => infeed.id === id);
}

export function endpointConductor(data: ProjectData, endpoint: WiringEndpoint): Conductor | undefined {
  if (endpoint.kind === 'device') {
    const device = data.devices.find((item) => item.id === endpoint.deviceId);
    if (
      !device ||
      endpoint.pole === undefined ||
      !Number.isInteger(endpoint.pole) ||
      endpoint.pole < 0 ||
      !['top', 'bottom'].includes(endpoint.side)
    )
      return undefined;
    const conductor = effectiveDevicePoles(device)[endpoint.pole];
    return conductor === 'L' ? (device.electrical?.phase ?? conductor) : conductor;
  }
  if (endpoint.kind === 'bus') {
    const bus = findBus(data, endpoint.busId);
    return bus && Number.isInteger(endpoint.terminal) && endpoint.terminal >= 0 && endpoint.terminal < bus.capacity
      ? bus.conductor
      : undefined;
  }
  const infeed = findInfeed(data, endpoint.infeedId);
  return infeed && Number.isInteger(endpoint.pole) && endpoint.pole >= 0 ? infeed.poles[endpoint.pole] : undefined;
}

export function wiringEndpointLabel(data: ProjectData, endpoint: WiringEndpoint): string {
  const conductor = endpointConductor(data, endpoint) ?? '?';
  if (endpoint.kind === 'device') {
    const device = data.devices.find((item) => item.id === endpoint.deviceId);
    const physical = device && endpoint.pole !== undefined ? devicePhysicalPoleOrder(device).indexOf(endpoint.pole) : -1;
    return `${device?.code ?? endpoint.deviceId} · ${t(endpoint.side === 'top' ? 'felső' : 'alsó')} ${physical < 0 ? '?' : physical + 1} (${conductor})`;
  }
  if (endpoint.kind === 'bus') {
    const bus = findBus(data, endpoint.busId);
    return `${bus?.name ?? endpoint.busId} · ${bus?.terminalLabels[endpoint.terminal] || endpoint.terminal + 1} (${conductor})`;
  }
  return `${findInfeed(data, endpoint.infeedId)?.name ?? endpoint.infeedId} · ${endpoint.pole + 1} (${conductor})`;
}

// Top and bottom are opposite ends of the same pole; different poles never merge.
function node(endpoint: WiringEndpoint, devices?: ReadonlyMap<string, Device>): string {
  if (endpoint.kind === 'device') {
    const group =
      endpoint.pole === undefined
        ? undefined
        : devices?.get(endpoint.deviceId)?.electrical?.commonPoleGroups?.find((item) => item.includes(endpoint.pole!));
    return JSON.stringify(['device', endpoint.deviceId, group?.length ? Math.min(...group) : endpoint.pole]);
  }
  return JSON.stringify(
    endpoint.kind === 'bus' ? ['bus', endpoint.busId] : ['infeed', endpoint.infeedId, endpoint.pole]
  );
}
function compatible(a: Conductor, b: Conductor): boolean {
  if (a === b) return true;
  if (a === 'PEN' || b === 'PEN') return ['PEN', 'PE', 'N'].includes(a) && ['PEN', 'PE', 'N'].includes(b);
  return (a === 'L' && phases.includes(b as Phase)) || (b === 'L' && phases.includes(a as Phase));
}
export interface WiringIssue {
  code: string;
  severity: 'warning' | 'error';
  message: string;
  wireId?: string;
  busId?: string;
  deviceId?: string;
}

/** Read-only topology checks. Imported loops remain intact and wire order is irrelevant. */
export function getWiringIssues(data: ProjectData, board: Board): WiringIssue[] {
  const issues: WiringIssue[] = [...getPhaseAssignmentIssues(data, board), ...getBoardTerminalWarnings(data, board)];
  if (!board.wiring) return issues;
  const devices = new Map(data.devices.map((device) => [device.id, device]));
  const keyOf = (endpoint: WiringEndpoint) => node(endpoint, devices);
  const devicePoles = new Map(data.devices.map((device) => [device.id, effectiveDevicePoles(device)]));
  const buses = new Map(data.boards.flatMap((item) => item.wiring?.buses ?? []).map((bus) => [bus.id, bus]));
  const infeeds = new Map(
    data.boards.flatMap((item) => item.wiring?.infeeds ?? []).map((infeed) => [infeed.id, infeed])
  );
  const conductorAt = (endpoint: WiringEndpoint): Conductor | undefined => {
    if (endpoint.kind === 'device') {
      if (
        endpoint.pole === undefined ||
        !Number.isInteger(endpoint.pole) ||
        endpoint.pole < 0 ||
        !['top', 'bottom'].includes(endpoint.side)
      )
        return undefined;
      const conductor = devicePoles.get(endpoint.deviceId)?.[endpoint.pole];
      return conductor === 'L' ? (devices.get(endpoint.deviceId)?.electrical?.phase ?? conductor) : conductor;
    }
    if (endpoint.kind === 'bus') {
      const bus = buses.get(endpoint.busId);
      return bus && Number.isInteger(endpoint.terminal) && endpoint.terminal >= 0 && endpoint.terminal < bus.capacity
        ? bus.conductor
        : undefined;
    }
    return Number.isInteger(endpoint.pole) && endpoint.pole >= 0
      ? infeeds.get(endpoint.infeedId)?.poles[endpoint.pole]
      : undefined;
  };
  const parents = new Map<string, string>();
  const conductors = new Map<string, Set<Conductor>>();
  const sources = new Map<string, Set<string>>();
  const active = new Set<string>();
  const connectedNodes = new Set<string>();
  const sourceNodes = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    if (!parents.has(root)) parents.set(root, root);
    while (parents.get(root) !== root) root = parents.get(root)!;
    let current = key;
    while (parents.get(current) !== root) {
      const next = parents.get(current)!;
      parents.set(current, root);
      current = next;
    }
    return root;
  };
  const join = (a: string, b: string) => {
    const ar = find(a),
      br = find(b);
    if (ar !== br) parents.set(br, ar);
  };
  const register = (endpoint: WiringEndpoint) => {
    const key = keyOf(endpoint),
      conductor = conductorAt(endpoint);
    find(key);
    if (conductor) {
      const set = conductors.get(key) ?? new Set<Conductor>();
      set.add(conductor);
      conductors.set(key, set);
    }
    return key;
  };
  for (const candidate of data.boards) {
    for (const infeed of candidate.wiring?.infeeds ?? [])
      infeed.poles.forEach((conductor, pole) => {
        const key = register({ kind: 'infeed', infeedId: infeed.id, pole });
        // Earth electrodes never count as a phase or neutral supply.
        if (infeed.kind === 'supply' || conductor === 'PE' || conductor === 'PEN') sourceNodes.set(key, infeed.id);
      });
    for (const bus of candidate.wiring?.buses ?? []) {
      const key = register({ kind: 'bus', busId: bus.id, terminal: 0 });
      if (candidate.id === board.id) active.add(key);
    }
    for (const wire of candidate.wiring?.wires ?? []) {
      const a = conductorAt(wire.from),
        b = conductorAt(wire.to);
      if (!a || !b) {
        if (candidate.id === board.id)
          issues.push({
            code: 'endpoint',
            severity: 'error',
            wireId: wire.id,
            message: t('{wire}: hiányzó készülék, sín, betáplálás vagy érvénytelen kapocsszám.', {
              wire: wire.label || wire.id
            })
          });
        continue;
      }
      const ak = register(wire.from),
        bk = register(wire.to);
      if (candidate.id === board.id) {
        active.add(ak);
        active.add(bk);
      }
      if (!compatible(a, b)) {
        if (candidate.id === board.id)
          issues.push({
            code: 'conductor',
            severity: 'error',
            wireId: wire.id,
            message: t('{wire}: eltérő vezetőfunkciók kapcsolódnak ({from} – {to}).', {
              wire: wire.label || wire.id,
              from: a,
              to: b
            })
          });
        continue;
      }
      join(ak, bk);
      connectedNodes.add(ak);
      connectedNodes.add(bk);
    }
  }
  for (const device of data.devices.filter((item) => item.electrical?.role === 'supply')) {
    devicePoles
      .get(device.id)!
      .forEach((_conductor, pole) =>
        sourceNodes.set(register({ kind: 'device', deviceId: device.id, side: 'top', pole }), device.id)
      );
  }
  const componentConductors = new Map<string, Set<Conductor>>();
  for (const [key, items] of conductors) {
    const root = find(key),
      group = componentConductors.get(root) ?? new Set<Conductor>();
    items.forEach((item) => group.add(item));
    componentConductors.set(root, group);
  }
  for (const [key, source] of sourceNodes) {
    const root = find(key),
      group = sources.get(root) ?? new Set<string>();
    group.add(source);
    sources.set(root, group);
  }
  const checked = new Set<string>();
  const busComponents = new Set(
    board.wiring.buses.map((bus) => find(keyOf({ kind: 'bus', busId: bus.id, terminal: 0 })))
  );
  for (const key of active) {
    const root = find(key);
    if (checked.has(root)) continue;
    checked.add(root);
    const group = componentConductors.get(root) ?? new Set<Conductor>();
    if (phases.filter((phase) => group.has(phase)).length > 1)
      issues.push({
        code: 'phase-conflict',
        severity: 'error',
        message: t('Egy összefüggő vezetőhálózat több különböző fázist köt össze.')
      });
    if ((sources.get(root)?.size ?? 0) > 1 && [...group].some((item) => item === 'L' || phases.includes(item as Phase)))
      issues.push({
        code: 'multiple-sources',
        severity: 'warning',
        message: t('Egy fázisvezető-hálózathoz több betáplálás csatlakozik; ellenőrizd a táplálási rendet.')
      });
    if (
      !busComponents.has(root) &&
      !sources.get(root)?.size &&
      [...group].some((item) => item === 'L' || phases.includes(item as Phase))
    )
      issues.push({
        code: 'no-feed',
        severity: 'warning',
        message: t('Egy fázisvezető-hálózatnak nincs követhető betáplálása.')
      });
  }
  // Use a second disjoint-set pass for undirected cycles, including disconnected
  // components and parallel wires. Never use device-level directed graph pruning.
  const cycleParents = new Map<string, string>();
  const cycleFind = (key: string): string => {
    let root = key;
    while (cycleParents.has(root)) root = cycleParents.get(root)!;
    let current = key;
    while (cycleParents.has(current)) {
      const next = cycleParents.get(current)!;
      cycleParents.set(current, root);
      current = next;
    }
    return root;
  };
  const cycleComponents = new Set<string>();
  for (const candidate of data.boards)
    for (const wire of candidate.wiring?.wires ?? []) {
      const a = conductorAt(wire.from),
        b = conductorAt(wire.to);
      if (!a || !b || !compatible(a, b)) continue;
      const ak = keyOf(wire.from),
        bk = keyOf(wire.to),
        ar = cycleFind(ak),
        br = cycleFind(bk);
      if (ar === br) cycleComponents.add(find(ak));
      else cycleParents.set(br, ar);
    }
  for (const root of cycleComponents)
    if (checked.has(root))
      issues.push({
        code: 'cycle',
        severity: 'warning',
        message: t('Hurok található egy vezetőhálózatban. Minden vezeték megmaradt; ellenőrizd a kapcsolást.')
      });
  for (const bus of board.wiring.buses) {
    const key = keyOf({ kind: 'bus', busId: bus.id, terminal: 0 });
    const attached = connectedNodes.has(key);
    if (!attached)
      issues.push({
        code: 'unconnected-bus',
        severity: 'warning',
        busId: bus.id,
        message: t('{name}: a sínhez nem csatlakozik vezeték.', { name: bus.name })
      });
    else if (!sources.get(find(key))?.size)
      issues.push({
        code: 'no-feed',
        severity: 'warning',
        busId: bus.id,
        message: t('{name}: nem követhető vezetőazonos kapcsolat a betáplálásig.', { name: bus.name })
      });
  }
  return issues;
}

function boardCircuits(data: ProjectData, board: Board): Circuit[] {
  const ids = new Set(board.rows.flatMap((row) => row.placements.map((item) => item.deviceId)));
  data.devices.filter((device) => device.boardId === board.id).forEach((device) => ids.add(device.id));
  const addEndpoint = (id: string) => {
    const device = data.devices.find((item) => item.id === id);
    const physicalBoard = data.boards.find((candidate) =>
      candidate.rows.some((row) => row.placements.some((item) => item.deviceId === id))
    );
    // A cross-board feeder does not move the remote board's consumer load here.
    if (physicalBoard ? physicalBoard.id === board.id : !device?.boardId || device.boardId === board.id) ids.add(id);
  };
  for (const wire of board.wiring?.wires ?? [])
    for (const endpoint of [wire.from, wire.to]) if (endpoint.kind === 'device') addEndpoint(endpoint.deviceId);
  for (const link of board.connections ?? []) {
    if (link.fromDeviceId) addEndpoint(link.fromDeviceId);
    addEndpoint(link.toDeviceId);
  }
  return data.circuits.filter(
    (circuit) =>
      (circuit.protectionDeviceId && ids.has(circuit.protectionDeviceId)) ||
      data.devices.some((device) => ids.has(device.id) && device.circuitId === circuit.id)
  );
}
function circuitDevice(data: ProjectData, circuit: Circuit): Device | undefined {
  if (circuit.protectionDeviceId) return data.devices.find((device) => device.id === circuit.protectionDeviceId);
  const associated = data.devices.filter((device) => device.circuitId === circuit.id);
  // An imported contactor or cabinet outlet can carry a load without being a
  // protection device; prefer that cabinet device over floor-plan consumers.
  return (
    associated.find((device) => device.moduleWidth !== undefined) ??
    associated.find((device) => device.electrical) ??
    associated[0]
  );
}
function isThreePhase(device?: Device): boolean {
  return !!device && phases.every((phase) => effectiveDevicePoles(device).includes(phase));
}
function phaseGroupKey(data: ProjectData, circuit: Circuit): string {
  const device = circuitDevice(data, circuit);
  return device ? `device:${device.id}` : `circuit:${circuit.id}`;
}
function phaseGroups(data: ProjectData, circuits: Circuit[]): Map<string, Circuit[]> {
  const groups = new Map<string, Circuit[]>();
  for (const circuit of circuits) {
    const key = phaseGroupKey(data, circuit),
      group = groups.get(key) ?? [];
    group.push(circuit);
    groups.set(key, group);
  }
  return groups;
}
function fixedGroupPhases(data: ProjectData, circuits: Circuit[]): Phase[] {
  const fixed = new Set<Phase>();
  for (const circuit of circuits) {
    if (circuit.phase) fixed.add(circuit.phase);
    const device = circuitDevice(data, circuit);
    if (!isThreePhase(device) && device?.electrical?.phase) fixed.add(device.electrical.phase);
  }
  return [...fixed];
}
function circuitPhases(data: ProjectData, circuit: Circuit, siblings: Circuit[]): Phase[] {
  if (circuit.phase) return [circuit.phase];
  if (isThreePhase(circuitDevice(data, circuit))) return phases;
  const fixed = fixedGroupPhases(data, siblings);
  return fixed.length === 1 ? fixed : [];
}
function getPhaseAssignmentIssues(data: ProjectData, board: Board): WiringIssue[] {
  const issues: WiringIssue[] = [];
  for (const group of phaseGroups(data, boardCircuits(data, board)).values()) {
    const device = circuitDevice(data, group[0]);
    if (device && !isThreePhase(device) && fixedGroupPhases(data, group).length > 1)
      issues.push({
        code: 'phase-assignment-conflict',
        severity: 'warning',
        deviceId: device.id,
        message: t(
          '{code}: az ugyanahhoz az egyfázisú készülékhez tartozó áramkörök fázisadatai eltérnek. Ellenőrizd a kiosztást.',
          { code: device.code }
        )
      });
  }
  return issues;
}
export interface PhaseLoads {
  L1: number;
  L2: number;
  L3: number;
  unassignedW: number;
  totalW: number;
}
export function getPhaseLoads(data: ProjectData, board: Board): PhaseLoads {
  const loads: PhaseLoads = { L1: 0, L2: 0, L3: 0, unassignedW: 0, totalW: 0 };
  const circuits = boardCircuits(data, board),
    groups = phaseGroups(data, circuits);
  for (const circuit of circuits) {
    const power = Number.isFinite(circuit.powerW) ? Math.max(0, circuit.powerW!) : 0;
    const assigned = circuitPhases(data, circuit, groups.get(phaseGroupKey(data, circuit))!);
    loads.totalW += power;
    if (!assigned.length) loads.unassignedW += power;
    else
      assigned.forEach((phase) => {
        loads[phase] += power / assigned.length;
      });
  }
  return loads;
}

/** Greedy balancing assigns each physical single-phase feeder as one group. */
export function balanceUnassignedPhases(data: ProjectData, board: Board): ProjectData {
  const next = structuredClone(data),
    loads = getPhaseLoads(data, board);
  const power = (circuit: Circuit) => (Number.isFinite(circuit.powerW) ? Math.max(0, circuit.powerW!) : 0);
  const pending = [...phaseGroups(data, boardCircuits(data, board))]
    .map(([key, group]) => ({
      key,
      group,
      unassigned: group.filter((circuit) => !circuit.phase),
      fixed: fixedGroupPhases(data, group)
    }))
    .filter(
      (item) => item.unassigned.length && !isThreePhase(circuitDevice(data, item.group[0])) && item.fixed.length <= 1
    )
    .sort(
      (a, b) =>
        b.unassigned.reduce((sum, circuit) => sum + power(circuit), 0) -
          a.unassigned.reduce((sum, circuit) => sum + power(circuit), 0) || a.key.localeCompare(b.key)
    );
  const targets = new Map(next.circuits.map((circuit) => [circuit.id, circuit]));
  for (const item of pending) {
    const phase =
      item.fixed[0] ?? phases.reduce((best, candidate) => (loads[candidate] < loads[best] ? candidate : best), 'L1');
    for (const circuit of item.unassigned) targets.get(circuit.id)!.phase = phase;
    // Fixed sibling/device phases were already included in the initial totals.
    if (!item.fixed.length) loads[phase] += item.unassigned.reduce((sum, circuit) => sum + power(circuit), 0);
  }
  return next;
}

/** Resistive estimate only; resistance must be provided from manufacturer data. */
export function estimateVoltageDrop(
  cable: CableDetails | undefined,
  currentA: number,
  voltage = 230,
  threePhase = false
): { volts: number; percent: number } | undefined {
  if (
    !cable ||
    cable.lengthM === undefined ||
    !Number.isFinite(cable.lengthM) ||
    cable.lengthM < 0 ||
    !Number.isFinite(cable.resistanceOhmPerKm) ||
    cable.resistanceOhmPerKm! <= 0 ||
    !Number.isFinite(currentA) ||
    currentA < 0 ||
    !Number.isFinite(voltage) ||
    voltage <= 0
  )
    return undefined;
  const volts = (((threePhase ? Math.sqrt(3) : 2) * cable.lengthM) / 1000) * cable.resistanceOhmPerKm! * currentA;
  return { volts, percent: (volts / voltage) * 100 };
}

/** A new explicit phase-bus connection may fill an unassigned single-phase device. */
export function assignConnectedPhase(data: ProjectData, from: WiringEndpoint, to: WiringEndpoint) {
  const terminal =
    from.kind === 'device' && to.kind === 'bus' ? from : to.kind === 'device' && from.kind === 'bus' ? to : undefined;
  const busEndpoint =
    from.kind === 'bus' && to.kind === 'device' ? from : to.kind === 'bus' && from.kind === 'device' ? to : undefined;
  if (!terminal || !busEndpoint || terminal.pole === undefined) return;
  const phase = endpointConductor(data, busEndpoint);
  if (phase !== 'L1' && phase !== 'L2' && phase !== 'L3') return;
  const device = data.devices.find((item) => item.id === terminal.deviceId);
  if (!device || device.electrical?.phase) return;
  const poles = effectiveDevicePoles(device),
    pole = poles[terminal.pole],
    livePoles = new Set(poles.filter((conductor) => ['L', 'L1', 'L2', 'L3'].includes(conductor)));
  if (livePoles.size !== 1 || (pole !== 'L' && pole !== phase)) return;
  const circuits = data.circuits.filter(
    (circuit) => circuit.protectionDeviceId === device.id || circuit.id === device.circuitId
  );
  if (circuits.some((circuit) => circuit.phase && circuit.phase !== phase)) return;
  device.electrical = { ...device.electrical, poles, phase, physicalPoleOrder: preservedPhysicalPoleOrder(device) };
}
