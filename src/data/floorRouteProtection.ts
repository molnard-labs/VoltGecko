import type { Conductor, Device, ProjectData, WiringEndpoint } from '../types';
import { isBoardRouteTerminalCompatible } from './boardRouteConnections';
import { floorRouteCircuitId } from './floorRouteCircuit';

const live = new Set<Conductor>(['L', 'L1', 'L2', 'L3']);

/** Only overcurrent protective devices qualify; an RCD alone does not. */
export function isCircuitProtectionDevice(device: Device): boolean {
  return device.kind === 'breaker' || device.kind === 'rcbo' ||
    device.electrical?.role === 'mcb' || device.electrical?.role === 'rcbo';
}

/** Find all proven candidates, without assuming how a cabinet is wired. */
export function circuitProtectionCandidates(data: ProjectData, circuitId: string): Device[] {
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const boardDeviceIds = new Set(data.boards.flatMap(board => [
    ...board.rows.flatMap(row => row.placements.map(placement => placement.deviceId)),
    ...data.devices.filter(device => device.boardId === board.id && device.moduleWidth !== undefined).map(device => device.id),
  ]));
  const ids = new Set<string>();
  for (const device of data.devices)
    if (device.circuitId === circuitId && boardDeviceIds.has(device.id) && isCircuitProtectionDevice(device)) ids.add(device.id);
  const circuit = data.circuits.find(item => item.id === circuitId);
  for (const connection of circuit?.boardConnections ?? []) {
    for (const item of connection.terminals) {
      if (!live.has(item.conductor) || item.endpoint.kind !== 'device' ||
          !isBoardRouteTerminalCompatible(data, connection.boardId, item.conductor, item.endpoint)) continue;
      const device = devices.get(item.endpoint.deviceId);
      if (device && isCircuitProtectionDevice(device)) ids.add(device.id);
    }
  }
  // Archives created before circuit-based cabinets still work until their one-time migration.
  if (!data.circuitBoardMigration) for (const sheet of data.sheets) for (const route of sheet.routes) {
    if (route.kind !== 'power' || floorRouteCircuitId(route, devices) !== circuitId) continue;
    for (const item of route.boardTerminals ?? []) {
      if (!live.has(item.conductor) || item.endpoint.kind !== 'device' ||
          !isBoardRouteTerminalCompatible(data, item.boardId, item.conductor, item.endpoint)) continue;
      const device = devices.get(item.endpoint.deviceId);
      if (device && isCircuitProtectionDevice(device)) ids.add(device.id);
    }
  }
  return [...ids].flatMap(id => devices.get(id) ? [devices.get(id)!] : []);
}

export type CircuitProtectionStatus = {
  kind: 'none' | 'unassigned' | 'match' | 'conflict' | 'ambiguous';
  circuitId: string;
  candidateDeviceIds: string[];
  deviceId?: string;
  currentDeviceId?: string;
};

/** Describe conflicts without overwriting a manually selected protective device. */
export function circuitProtectionStatus(data: ProjectData, circuitId: string): CircuitProtectionStatus {
  const circuit = data.circuits.find(item => item.id === circuitId);
  const ids = circuitProtectionCandidates(data, circuitId).map(device => device.id);
  const base = { circuitId, candidateDeviceIds: ids, currentDeviceId: circuit?.protectionDeviceId };
  if (!circuit || !ids.length) return { ...base, kind:'none' };
  if (ids.length > 1) return { ...base, kind:'ambiguous' };
  const deviceId = ids[0];
  return { ...base, deviceId, kind: !circuit.protectionDeviceId ? 'unassigned' : circuit.protectionDeviceId === deviceId ? 'match' : 'conflict' };
}

/** Reconcile only explicitly automatic assignments after a project edit or deletion. */
export function reconcileAutoProtections(data: ProjectData): ProjectData {
  let changed = false;
  const circuits = data.circuits.map(circuit => {
    if (circuit.protectionAuto !== true) return circuit;
    const candidates = circuitProtectionCandidates(data, circuit.id);
    const candidate = candidates.length === 1 ? candidates[0].id : undefined;
    if (candidate === circuit.protectionDeviceId && candidates.length) return circuit;
    const next = { ...circuit };
    if (candidate) next.protectionDeviceId = candidate;
    else delete next.protectionDeviceId;
    // Keep an automatic-but-unresolved marker only while multiple candidates exist,
    // so it can resolve itself when the ambiguity is corrected.
    if (!candidates.length) delete next.protectionAuto;
    changed = true;
    return next;
  });
  return changed ? { ...data, circuits } : data;
}

/** Explicit linking action may fill an empty circuit when the candidate is unique. */
export function syncCircuitProtection(data: ProjectData, circuitId: string | undefined): ProjectData {
  const next = reconcileAutoProtections(data);
  if (!circuitId) return next;
  const circuit = next.circuits.find(item => item.id === circuitId);
  if (!circuit || circuit.protectionDeviceId) return next;
  const candidates = circuitProtectionCandidates(next, circuitId);
  if (candidates.length !== 1) return next;
  return { ...next, circuits: next.circuits.map(item => item.id === circuitId
    ? { ...item, protectionDeviceId: candidates[0].id, protectionAuto:true } : item) };
}

export function routeProtectionStatus(data: ProjectData, sheetId: string, routeId: string): CircuitProtectionStatus | undefined {
  const route = data.sheets.find(sheet => sheet.id === sheetId)?.routes.find(item => item.id === routeId);
  if (!route || route.kind !== 'power') return undefined;
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const circuitId = floorRouteCircuitId(route, devices);
  return circuitId ? circuitProtectionStatus(data, circuitId) : undefined;
}

export function syncRouteProtection(data: ProjectData, sheetId: string, routeId: string): ProjectData {
  const route = data.sheets.find(sheet => sheet.id === sheetId)?.routes.find(item => item.id === routeId);
  const devices = new Map(data.devices.map(device => [device.id, device]));
  return syncCircuitProtection(data, route?.kind === 'power' ? floorRouteCircuitId(route, devices) : undefined);
}

/** User-confirmed selection is explicitly manual and is never silently replaced. */
export function adoptCircuitProtection(data: ProjectData, circuitId: string, deviceId: string): ProjectData {
  if (!circuitProtectionCandidates(data, circuitId).some(device => device.id === deviceId)) return data;
  return { ...data, circuits: data.circuits.map(circuit => {
    if (circuit.id !== circuitId) return circuit;
    const next = { ...circuit, protectionDeviceId: deviceId };
    delete next.protectionAuto;
    return next;
  }) };
}

/** Set one board-side conductor terminal from either the panel or the diagram. */
export function assignFloorRouteTerminal(data: ProjectData, sheetId: string, routeId: string, boardId: string, conductor: Conductor, endpoint?: WiringEndpoint): ProjectData {
  const sheet = data.sheets.find(item => item.id === sheetId);
  const route = sheet?.routes.find(item => item.id === routeId);
  if (!sheet || !route || (route.fromBoardId !== boardId && route.toBoardId !== boardId) ||
      (endpoint && !isBoardRouteTerminalCompatible(data, boardId, conductor, endpoint))) return data;
  const terminals = (route.boardTerminals ?? []).filter(item => item.boardId !== boardId || item.conductor !== conductor);
  if (endpoint) terminals.push({ boardId, conductor, endpoint });
  const replacement = { ...route };
  if (terminals.length) replacement.boardTerminals = terminals;
  else delete replacement.boardTerminals;
  const next = { ...data, sheets:data.sheets.map(item => item.id === sheetId
    ? { ...item, routes:item.routes.map(value => value.id === routeId ? replacement : value) } : item) };
  return endpoint && live.has(conductor)
    ? syncRouteProtection(next, sheetId, routeId)
    : reconcileAutoProtections(next);
}
