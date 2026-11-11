import type { Circuit, CircuitBoardConnection, Conductor, PlanSheet, Point, ProjectData, Route, WiringEndpoint } from '../types';
import { isBoardRouteTerminalCompatible, isBoardRouteTerminalPresent } from './boardRouteConnections';
import { floorRouteCircuitId } from './floorRouteCircuit';
import { reconcileAutoProtections, syncCircuitProtection } from './floorRouteProtection';
import { circuitBelongsToBoard } from './circuitBoardAssociation';

const live = new Set<Conductor>(['L','L1','L2','L3']);
export const circuitEndpointKey = (endpoint: WiringEndpoint): string => endpoint.kind === 'device'
  ? JSON.stringify(['device',endpoint.deviceId,endpoint.side,endpoint.pole])
  : endpoint.kind === 'bus' ? JSON.stringify(['bus',endpoint.busId,endpoint.terminal])
  : JSON.stringify(['infeed',endpoint.infeedId,endpoint.pole]);

/** Project circuits are visible on the only board, otherwise only on their selected or protective-device board. */
export function getCircuitBoardConnections(data: ProjectData, boardId: string): {circuit:Circuit; connection:CircuitBoardConnection}[] {
  if (!data.boards.some(board => board.id === boardId)) return [];
  return data.circuits.flatMap(circuit => {
    const stored = circuit.boardConnections?.find(item => item.boardId === boardId);
    if (stored?.hidden) return [];
    if (!circuitBelongsToBoard(data,circuit,boardId)) return [];
    return [{circuit,connection:stored ?? {boardId,terminals:[]}}];
  });
}

/** Keep formerly implicit single-board circuits on that board when a second is added. */
export function preserveSingleBoardCircuits(previous:ProjectData, next:ProjectData):ProjectData {
  if (previous.id !== next.id || previous.boards.length !== 1 || next.boards.length <= 1) return next;
  const boardId = previous.boards[0].id;
  if (!next.boards.some(board => board.id === boardId)) return next;
  const visible = new Set(getCircuitBoardConnections(previous,boardId).map(item => item.circuit.id));
  let changed = false;
  const circuits = next.circuits.map(circuit => {
    if (!visible.has(circuit.id) || circuit.boardConnections?.some(connection => connection.boardId === boardId)) return circuit;
    changed = true;
    return {...circuit,boardConnections:[...(circuit.boardConnections ?? []),{boardId,terminals:[]}]};
  });
  return changed ? {...next,circuits} : next;
}

function updateConnection(data: ProjectData, circuitId: string, boardId: string, edit:(connection:CircuitBoardConnection)=>void): ProjectData {
  const circuit = data.circuits.find(item => item.id === circuitId);
  if (!circuit || !data.boards.some(board => board.id === boardId)) return data;
  const stored = circuit.boardConnections?.find(item => item.boardId === boardId);
  const connection = structuredClone(stored ?? {boardId,terminals:[]});
  edit(connection);
  return {...data,circuits:data.circuits.map(item => item.id !== circuitId ? item : {
    ...item, boardConnections:[...(item.boardConnections ?? []).filter(value => value.boardId !== boardId),connection]
  })};
}

/** Hiding a circuit preserves its terminal assignments and placement for later re-adding. */
export function setCircuitBoardVisible(data: ProjectData, circuitId: string, boardId: string, visible:boolean): ProjectData {
  return reconcileAutoProtections(updateConnection(data,circuitId,boardId,connection => {
    if (visible) delete connection.hidden; else connection.hidden = true;
  }));
}

/** Delete the circuit while leaving the floor drawing and unrelated legacy decisions intact. */
export function deleteCircuit(data: ProjectData, circuitId: string): ProjectData {
  if (!data.circuits.some(circuit => circuit.id === circuitId)) return data;
  const devices = new Map(data.devices.map(device => [device.id,device]));
  const next = structuredClone(data);
  for (const sheet of next.sheets) for (const route of sheet.routes) {
    const belonged = floorRouteCircuitId(route,devices) === circuitId;
    if (route.circuitId === circuitId) delete route.circuitId;
    if (route.explicitCircuitId === circuitId) delete route.explicitCircuitId;
    if (belonged) {
      // Legacy unresolved boards still require an explicit user decision.
      const unresolved = new Set(route.legacyUnassignedBoards ?? []);
      const terminals = route.boardTerminals?.filter(item => unresolved.has(item.boardId));
      const positions = route.boardPositions?.filter(item => unresolved.has(item.boardId));
      if (terminals?.length) route.boardTerminals = terminals; else delete route.boardTerminals;
      if (positions?.length) route.boardPositions = positions; else delete route.boardPositions;
    }
  }
  next.circuits = next.circuits.filter(circuit => circuit.id !== circuitId);
  for (const device of next.devices) if (device.circuitId === circuitId) delete device.circuitId;
  return next;
}

export function setCircuitBoardPosition(data: ProjectData, circuitId: string, boardId: string, point:Point): ProjectData {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return data;
  return updateConnection(data,circuitId,boardId,connection => { connection.position = {...point}; delete connection.legacyPositionConflict; delete connection.legacyPositionOptions; });
}

export function assignCircuitBoardTerminal(data: ProjectData, circuitId: string, boardId: string, conductor:Conductor, endpoint?:WiringEndpoint): ProjectData {
  if (endpoint && !isBoardRouteTerminalCompatible(data,boardId,conductor,endpoint)) return data;
  const next = updateConnection(data,circuitId,boardId,connection => {
    const existing = connection.terminals.find(item => item.conductor === conductor);
    connection.terminals = connection.terminals.filter(item => item.conductor !== conductor);
    if (endpoint) connection.terminals.push({...existing,conductor,endpoint});
    const conflicts = connection.legacyTerminalConflicts?.filter(item => item.conductor !== conductor);
    if (conflicts?.length) connection.legacyTerminalConflicts = conflicts; else delete connection.legacyTerminalConflicts;
  });
  return endpoint && live.has(conductor) ? syncCircuitProtection(next,circuitId) : reconcileAutoProtections(next);
}

/** Save only the interior route points, separately for each circuit conductor. */
export function setCircuitBoardTerminalPoints(data:ProjectData, circuitId:string, boardId:string, conductor:Conductor, points?:Point[]):ProjectData {
  const terminal = data.circuits.find(item => item.id === circuitId)?.boardConnections
    ?.find(item => item.boardId === boardId)?.terminals.find(item => item.conductor === conductor);
  if (!terminal || (points && (points.length > 10_000 || points.some(point =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1_000_000_000 || Math.abs(point.y) > 1_000_000_000)))) return data;
  return updateConnection(data,circuitId,boardId,connection => {
    const target = connection.terminals.find(item => item.conductor === conductor)!;
    if (points === undefined) delete target.points;
    else target.points = points.map(point => ({x:point.x,y:point.y}));
  });
}

/** Copy only unambiguous historical route metadata; original routes are retained unchanged. */
export function migrateLegacyCircuitBoardConnections(data: ProjectData): ProjectData {
  if (data.circuitBoardMigration) return data;
  const next = structuredClone(data), devices = new Map(next.devices.map(device => [device.id,device]));
  for (const sheet of next.sheets) for (const route of sheet.routes) {
    const circuitId = floorRouteCircuitId(route,devices), circuit = next.circuits.find(item => item.id === circuitId);
    if (!circuit) {
      const unresolved = [route.fromBoardId,route.toBoardId].filter((id):id is string => !!id &&
        ((route.boardTerminals ?? []).some(item => item.boardId === id) || (route.boardPositions ?? []).some(item => item.boardId === id)));
      if (unresolved.length) route.legacyUnassignedBoards = [...new Set(unresolved)];
      continue;
    }
    for (const boardId of [route.fromBoardId,route.toBoardId].filter((id):id is string => !!id)) {
      const terminals = (route.boardTerminals ?? []).filter(item => item.boardId === boardId);
      const oldPosition = route.boardPositions?.find(item => item.boardId === boardId);
      // Even an unconnected, unpositioned route proves that this circuit was assigned to the board.
      circuit.boardConnections ??= [];
      let connection = circuit.boardConnections.find(item => item.boardId === boardId);
      if (!connection) { connection = {boardId,terminals:[]}; circuit.boardConnections.push(connection); }
      for (const terminal of terminals) {
        const existing = connection.terminals.find(item => item.conductor === terminal.conductor);
        const conflict = connection.legacyTerminalConflicts?.find(item => item.conductor === terminal.conductor);
        const incomingKey = circuitEndpointKey(terminal.endpoint);
        if (conflict) {
          if (!conflict.endpoints.some(item => circuitEndpointKey(item) === incomingKey)) conflict.endpoints.push(terminal.endpoint);
        } else if (!existing) connection.terminals.push({conductor:terminal.conductor,endpoint:terminal.endpoint});
        else if (circuitEndpointKey(existing.endpoint) !== incomingKey) {
          connection.terminals = connection.terminals.filter(item => item.conductor !== terminal.conductor);
          (connection.legacyTerminalConflicts ??= []).push({conductor:terminal.conductor,endpoints:[existing.endpoint,terminal.endpoint]});
        }
      }
      if (oldPosition) {
        if (!connection.position && !connection.legacyPositionConflict) connection.position = {x:oldPosition.x,y:oldPosition.y};
        else if (connection.position && (connection.position.x !== oldPosition.x || connection.position.y !== oldPosition.y)) {
          connection.legacyPositionOptions = [connection.position,{x:oldPosition.x,y:oldPosition.y}];
          delete connection.position; connection.legacyPositionConflict = true;
        } else if (connection.legacyPositionConflict && !connection.legacyPositionOptions?.some(item => item.x === oldPosition.x && item.y === oldPosition.y)) {
          (connection.legacyPositionOptions ??= []).push({x:oldPosition.x,y:oldPosition.y});
        }
      }
    }
  }
  next.circuitBoardMigration = true;
  return next;
}

/** Historical board terminals without a determinable circuit require a user decision. */
export function getUnassignedLegacyBoardRoutes(data: ProjectData, boardId: string): {sheet:PlanSheet; route:Route}[] {
  const devices = new Map(data.devices.map(device => [device.id,device]));
  return data.sheets.flatMap(sheet => sheet.routes.filter(route =>
    (route.fromBoardId === boardId || route.toBoardId === boardId) &&
    ((route.boardTerminals ?? []).some(item => item.boardId === boardId) || (route.boardPositions ?? []).some(item => item.boardId === boardId)) &&
    (route.legacyUnassignedBoards?.includes(boardId) ?? (!data.circuitBoardMigration && !floorRouteCircuitId(route,devices)))
  ).map(route => ({sheet,route})));
}

/** Explicitly resolve one ambiguous legacy route and copy its cabinet data once. */
export function adoptUnassignedLegacyBoardRoute(data: ProjectData, sheetId: string, routeId: string, boardId: string, circuitId: string): ProjectData {
  if (!data.circuits.some(item => item.id === circuitId)) return data;
  const next = structuredClone(data);
  const sheet = next.sheets.find(item => item.id === sheetId), route = sheet?.routes.find(item => item.id === routeId);
  if (!sheet || !route || (route.fromBoardId !== boardId && route.toBoardId !== boardId) ||
      !getUnassignedLegacyBoardRoutes(data,boardId).some(item => item.sheet.id === sheetId && item.route.id === routeId)) return data;
  const isolatedRoute = {...route,fromBoardId:boardId,toBoardId:undefined,explicitCircuitId:circuitId,
    boardTerminals:route.boardTerminals?.filter(item => item.boardId === boardId),
    boardPositions:route.boardPositions?.filter(item => item.boardId === boardId)};
  const isolated = {...next,circuitBoardMigration:false,sheets:[{...sheet,routes:[isolatedRoute]}]};
  const migrated = migrateLegacyCircuitBoardConnections(isolated);
  next.circuits = migrated.circuits;
  const remainingTerminals = route.boardTerminals?.filter(item => item.boardId !== boardId);
  const remainingPositions = route.boardPositions?.filter(item => item.boardId !== boardId);
  if (remainingTerminals?.length) route.boardTerminals = remainingTerminals; else delete route.boardTerminals;
  if (remainingPositions?.length) route.boardPositions = remainingPositions; else delete route.boardPositions;
  const remainingUnassigned = route.legacyUnassignedBoards?.filter(id => id !== boardId);
  if (remainingUnassigned?.length) route.legacyUnassignedBoards = remainingUnassigned; else delete route.legacyUnassignedBoards;
  next.circuitBoardMigration = true;
  return syncCircuitProtection(next,circuitId);
}

/** Preserve valid conductor assignments after explicit deletion of their physical objects. */
export function pruneCircuitBoardConnections(data: ProjectData): ProjectData {
  const boards = new Set(data.boards.map(board => board.id));
  let changed = false;
  const circuits = data.circuits.map(circuit => {
    if (!circuit.boardConnections) return circuit;
    const connections = circuit.boardConnections.filter(item => boards.has(item.boardId)).map(item => {
      const terminals = item.terminals.filter(terminal => isBoardRouteTerminalPresent(data,item.boardId,terminal.endpoint));
      const conflicts = item.legacyTerminalConflicts?.map(conflict => ({...conflict,endpoints:conflict.endpoints.filter(endpoint => isBoardRouteTerminalPresent(data,item.boardId,endpoint))})).filter(conflict => conflict.endpoints.length);
      if (terminals.length === item.terminals.length && JSON.stringify(conflicts ?? []) === JSON.stringify(item.legacyTerminalConflicts ?? [])) return item;
      changed = true;
      return {...item,terminals,legacyTerminalConflicts:conflicts?.length ? conflicts : undefined};
    });
    if (connections.length !== circuit.boardConnections.length) changed = true;
    return connections.every((item,index) => item === circuit.boardConnections![index]) && connections.length === circuit.boardConnections.length
      ? circuit : {...circuit,boardConnections:connections};
  });
  return changed ? {...data,circuits} : data;
}
