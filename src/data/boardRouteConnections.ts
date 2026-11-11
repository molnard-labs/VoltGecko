import type { Conductor, ProjectData, WiringEndpoint } from '../types';
import { endpointConductor } from './boardWiring';

/** A terminal must belong to the board hosting this end of the floor route. */
export function isBoardRouteTerminalPresent(data: ProjectData, boardId: string, endpoint: WiringEndpoint): boolean {
  const board = data.boards.find(item => item.id === boardId);
  if (!board || !endpointConductor(data, endpoint)) return false;
  if (endpoint.kind === 'device') {
    const placed = board.rows.some(row => row.placements.some(item => item.deviceId === endpoint.deviceId));
    const assigned = data.devices.some(device => device.id === endpoint.deviceId && device.boardId === board.id && device.moduleWidth !== undefined);
    return placed || assigned;
  }
  if (endpoint.kind === 'bus') return !!board.wiring?.buses.some(bus => bus.id === endpoint.busId);
  return !!board.wiring?.infeeds.some(infeed => infeed.id === endpoint.infeedId);
}

/** Match the existing cabinet wiring compatibility rules for generic L and PEN. */
export function isBoardRouteTerminalCompatible(data: ProjectData, boardId: string, conductor: Conductor, endpoint: WiringEndpoint): boolean {
  if (!isBoardRouteTerminalPresent(data, boardId, endpoint)) return false;
  const other = endpointConductor(data, endpoint);
  if (!other) return false;
  if (conductor === other) return true;
  if (conductor === 'PEN' || other === 'PEN') return ['PEN', 'PE', 'N'].includes(conductor) && ['PEN', 'PE', 'N'].includes(other);
  return (conductor === 'L' && ['L1', 'L2', 'L3'].includes(other)) || (other === 'L' && ['L1', 'L2', 'L3'].includes(conductor));
}

/** Remove only references whose objects or physical terminals no longer exist. */
export function pruneInvalidBoardRouteTerminals(data: ProjectData): ProjectData {
  const circuits = new Set(data.circuits.map(circuit => circuit.id));
  const boards = new Set(data.boards.map(board => board.id));
  let changed = false;
  const sheets = data.sheets.map(sheet => {
    let sheetChanged = false;
    const routes = sheet.routes.map(route => {
      const terminals = route.boardTerminals?.filter(terminal =>
        (terminal.boardId === route.fromBoardId || terminal.boardId === route.toBoardId) &&
        isBoardRouteTerminalPresent(data, terminal.boardId, terminal.endpoint));
      const positions = route.boardPositions?.filter(position => boards.has(position.boardId) &&
        (position.boardId === route.fromBoardId || position.boardId === route.toBoardId));
      const missingCircuit = !!route.explicitCircuitId && !circuits.has(route.explicitCircuitId);
      if (!missingCircuit && terminals?.length === route.boardTerminals?.length && positions?.length === route.boardPositions?.length) return route;
      sheetChanged = true;
      const next = { ...route };
      if (missingCircuit) delete next.explicitCircuitId;
      if (terminals?.length) next.boardTerminals = terminals;
      else delete next.boardTerminals;
      if (positions?.length) next.boardPositions = positions;
      else delete next.boardPositions;
      return next;
    });
    if (!sheetChanged) return sheet;
    changed = true;
    return { ...sheet, routes };
  });
  return changed ? { ...data, sheets } : data;
}
