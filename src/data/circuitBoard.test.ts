import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { decodeProject, encodeProject, validateProject } from './archive';
import { createProject, deleteBoard, deleteDevice } from './project';
import { circuitProtectionCandidates, reconcileAutoProtections } from './floorRouteProtection';
import { getPhaseLoads, getWiringIssues } from './boardWiring';
import { adoptUnassignedLegacyBoardRoute, assignCircuitBoardTerminal, deleteCircuit, getCircuitBoardConnections, getUnassignedLegacyBoardRoutes, migrateLegacyCircuitBoardConnections, preserveSingleBoardCircuits, pruneCircuitBoardConnections, setCircuitBoardPosition, setCircuitBoardTerminalPoints, setCircuitBoardVisible, setCircuitBoardsVisible } from './circuitBoard';

function fixture() {
  const doc = createProject('Test');
  const board = doc.data.boards[0], breaker = makeDevice('breaker', []), outlet = makeDevice('outlet', [breaker]);
  breaker.electrical = {role:'mcb',poles:['L','N']};
  breaker.moduleWidth = 2;
  doc.data.devices = [breaker,outlet];
  board.rows[0].placements = [{deviceId:breaker.id,start:0}];
  doc.data.circuits = [{id:'c',code:'C1',name:'Konyha',color:'#123456',notes:''}];
  const sheet = doc.data.sheets[0];
  sheet.boardPlacements = [{boardId:board.id,x:20,y:20}];
  sheet.placements = [{deviceId:outlet.id,x:100,y:100,rotation:0}];
  const terminal = {kind:'device' as const,deviceId:breaker.id,side:'bottom' as const,pole:0};
  return {doc,board,breaker,outlet,sheet,terminal};
}

describe('circuit-based board connections', () => {
  it('globally hides and restores the drawing without altering terminals, wire bends, position or protective assignment', async () => {
    const {doc,board,breaker,terminal} = fixture();
    let connected = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    connected = setCircuitBoardPosition(connected,'c',board.id,{x:120,y:360});
    connected = setCircuitBoardTerminalPoints(connected,'c',board.id,'L',[{x:30,y:40}]);
    const prior = connected.circuits[0];
    expect(prior.protectionDeviceId).toBe(breaker.id);
    expect(getCircuitBoardConnections(connected,board.id)).toHaveLength(1);
    const hidden = setCircuitBoardsVisible(connected,'c',false);
    expect(hidden.circuits[0].hideOnBoards).toBe(true);
    expect(getCircuitBoardConnections(hidden,board.id)).toHaveLength(0);
    expect(getCircuitBoardConnections(hidden,board.id,{includeGloballyHidden:true})).toHaveLength(1);
    expect(hidden.circuits[0].boardConnections).toEqual(prior.boardConnections);
    expect(hidden.circuits[0].protectionDeviceId).toBe(prior.protectionDeviceId);
    const saved = await decodeProject(await encodeProject({...doc,data:hidden}));
    expect(saved.data.circuits[0].hideOnBoards).toBe(true);
    const restored = setCircuitBoardsVisible(saved.data,'c',true);
    expect(restored.circuits[0].hideOnBoards).toBeUndefined();
    expect(restored.circuits[0].boardConnections).toEqual(prior.boardConnections);
    expect(getCircuitBoardConnections(restored,board.id)).toHaveLength(1);
    const invalid = structuredClone(saved);
    (invalid.data.circuits[0] as unknown as {hideOnBoards:string}).hideOnBoards = 'yes';
    expect(() => validateProject(invalid)).toThrow();
  });
  it('retains implicit single-board membership if a globally hidden circuit gains another board', () => {
    const {doc,board} = fixture();
    const hidden = setCircuitBoardsVisible(doc.data,'c',false);
    const expanded = {...hidden,boards:[...hidden.boards,{...structuredClone(board),id:'second',rows:[]}]};
    const next = preserveSingleBoardCircuits(hidden,expanded);
    expect(next.circuits[0].boardConnections).toEqual([{boardId:board.id,terminals:[]}]);
    expect(getCircuitBoardConnections(next,board.id)).toHaveLength(0);
    const restored = setCircuitBoardsVisible(next,'c',true);
    expect(getCircuitBoardConnections(restored,board.id)).toHaveLength(1);
    expect(getCircuitBoardConnections(restored,'second')).toHaveLength(0);
  });
  it('preserves individual board hiding when global visibility is turned off and on', () => {
    const {doc,board} = fixture();
    const other = {...structuredClone(board),id:'other',rows:[]};
    let next = {...doc.data,boards:[...doc.data.boards,other]};
    next = setCircuitBoardVisible(next,'c',board.id,true);
    next = setCircuitBoardVisible(next,'c',other.id,false);
    next = setCircuitBoardsVisible(setCircuitBoardsVisible(next,'c',false),'c',true);
    expect(getCircuitBoardConnections(next,board.id)).toHaveLength(1);
    expect(getCircuitBoardConnections(next,other.id)).toHaveLength(0);
    expect(next.circuits[0].boardConnections?.find(item => item.boardId === other.id)?.hidden).toBe(true);
  });
  it('retains individual conductor routes through endpoint changes, archive export and import', async () => {
    const {doc,board,terminal} = fixture();
    const points = [{x:20,y:40},{x:50,y:40}];
    const connected = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    const routed = setCircuitBoardTerminalPoints(connected,'c',board.id,'L',points);
    expect(connected.circuits[0].boardConnections![0].terminals[0].points).toBeUndefined();
    expect(routed.circuits[0].boardConnections![0].terminals[0].points).toEqual(points);
    const reconnected = assignCircuitBoardTerminal(routed,'c',board.id,'L',{...terminal,side:'top'});
    expect(reconnected.circuits[0].boardConnections![0].terminals[0]).toMatchObject({points,endpoint:{...terminal,side:'top'}});
    const restored = await decodeProject(await encodeProject({...doc,data:reconnected}));
    expect(restored.data.circuits[0].boardConnections![0].terminals[0].points).toEqual(points);
    const reset = setCircuitBoardTerminalPoints(restored.data,'c',board.id,'L',undefined);
    expect(reset.circuits[0].boardConnections![0].terminals[0].points).toBeUndefined();
    const deleted = assignCircuitBoardTerminal(reconnected,'c',board.id,'L');
    expect(deleted.circuits[0].boardConnections![0].terminals).toEqual([]);
  });
  it('rejects malformed and oversized saved circuit wire points', () => {
    const {doc,board,terminal} = fixture();
    const connected = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    expect(setCircuitBoardTerminalPoints(connected,'c',board.id,'L',[{x:Infinity,y:0}])).toBe(connected);
    const malformed = structuredClone(connected);
    malformed.circuits[0].boardConnections![0].terminals[0].points = [{x:NaN,y:0}];
    expect(() => validateProject({...doc,data:malformed})).toThrow();
    malformed.circuits[0].boardConnections![0].terminals[0].points = Array(10_001).fill({x:0,y:0});
    expect(() => validateProject({...doc,data:malformed})).toThrow();
  });
  it('shows the single-board circuits and permits independent explicit hiding and restoring', () => {
    const {doc,board} = fixture();
    expect(getCircuitBoardConnections(doc.data,board.id)).toHaveLength(1);
    const hidden = setCircuitBoardVisible(doc.data,'c',board.id,false);
    expect(getCircuitBoardConnections(hidden,board.id)).toHaveLength(0);
    const shown = setCircuitBoardVisible(hidden,'c',board.id,true);
    expect(getCircuitBoardConnections(shown,board.id)).toHaveLength(1);
    expect(doc.data.circuits[0].boardConnections).toBeUndefined();
  });
  it('places circuits explicitly or by their protective device in multi-board projects', () => {
    const {doc,board,breaker} = fixture();
    doc.data.boards.push({...structuredClone(board),id:'other',rows:[]});
    expect(getCircuitBoardConnections(doc.data,board.id)).toHaveLength(0);
    doc.data.circuits[0].protectionDeviceId = breaker.id;
    expect(getCircuitBoardConnections(doc.data,board.id)).toHaveLength(1);
    expect(getCircuitBoardConnections(doc.data,'other')).toHaveLength(0);
    expect(getCircuitBoardConnections(setCircuitBoardVisible(doc.data,'c','other',true),'other')).toHaveLength(1);
  });
  it('preserves visible implicit single-board circuits when another board is added, without reviving hidden ones', () => {
    const {doc,board} = fixture();
    doc.data.circuits.push({id:'hidden',code:'H',name:'Hidden',color:'#123456',notes:''});
    const old = setCircuitBoardVisible(doc.data,'hidden',board.id,false);
    const expanded = {...old,boards:[...old.boards,{...structuredClone(board),id:'second',rows:[]}]};
    const next = preserveSingleBoardCircuits(old,expanded);
    expect(getCircuitBoardConnections(next,board.id).map(item=>item.circuit.id)).toEqual(['c']);
    expect(getCircuitBoardConnections(next,'second')).toEqual([]);
    expect(next.circuits[0].boardConnections).toEqual([{boardId:board.id,terminals:[]}]);
    expect(next.circuits[1].boardConnections![0].hidden).toBe(true);
    expect(preserveSingleBoardCircuits(next,next)).toBe(next);
  });
  it('counts assigned circuits in board phase loads even when their box is hidden', () => {
    const {doc,board} = fixture();
    const other = {...structuredClone(board),id:'other',rows:[]};
    doc.data.boards.push(other);
    doc.data.circuits[0].powerW = 700;
    doc.data.circuits[0].phase = 'L';
    let next = setCircuitBoardVisible(doc.data,'c',other.id,true);
    expect(getPhaseLoads(next,other).L).toBe(700);
    expect(getPhaseLoads(next,board).totalW).toBe(0);
    next = setCircuitBoardVisible(next,'c',other.id,false);
    expect(getCircuitBoardConnections(next,other.id)).toHaveLength(0);
    expect(getPhaseLoads(next,other).L).toBe(700);
  });
  it('recognizes an attached circuit terminal without electrically joining different conductors', () => {
    const {doc,board,terminal} = fixture();
    board.wiring = {wires:[],infeeds:[],buses:[{id:'n',name:'N sín',conductor:'N',capacity:2,position:'bottom',terminalLabels:['','']}]};
    let next = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    next = assignCircuitBoardTerminal(next,'c',board.id,'N',{kind:'bus',busId:'n',terminal:0});
    const issues = getWiringIssues(next,next.boards[0]);
    expect(issues.some(issue => issue.code === 'unconnected-bus')).toBe(false);
    expect(issues.some(issue => issue.code === 'no-feed' && issue.busId === 'n')).toBe(true);
    expect(issues.some(issue => issue.code === 'phase-conflict')).toBe(false);
    const changed = structuredClone(next);
    changed.boards[0].wiring!.buses[0].conductor = 'PE';
    expect(getWiringIssues(changed,changed.boards[0]).some(issue => issue.code === 'conductor')).toBe(true);
  });
  it('migrates consistent historical routes once and keeps wiring when the drawing route is deleted', async () => {
    const {doc,board,breaker,outlet,sheet,terminal} = fixture();
    delete doc.data.circuitBoardMigration;
    sheet.routes = [{id:'r',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',explicitCircuitId:'c',points:[],
      boardTerminals:[{boardId:board.id,conductor:'L',endpoint:terminal}],boardPositions:[{boardId:board.id,x:12,y:32}]}];
    const migrated = migrateLegacyCircuitBoardConnections(doc.data);
    expect(migrated.circuits[0].boardConnections).toEqual([{boardId:board.id,terminals:[{conductor:'L',endpoint:terminal}],position:{x:12,y:32}}]);
    expect(migrated.sheets[0].routes).toEqual(sheet.routes);
    expect(migrateLegacyCircuitBoardConnections(migrated)).toBe(migrated);
    const withoutDrawing = structuredClone(migrated); withoutDrawing.sheets[0].routes = [];
    expect(circuitProtectionCandidates(withoutDrawing,'c').map(device=>device.id)).toEqual([breaker.id]);
    const saved = await decodeProject(await encodeProject({...doc,data:withoutDrawing}));
    expect(saved.data.circuits[0].boardConnections).toEqual(migrated.circuits[0].boardConnections);
  });
  it('retains conflicting historical alternatives without choosing a false terminal or location', () => {
    const {doc,board,breaker,outlet,sheet,terminal} = fixture();
    delete doc.data.circuitBoardMigration;
    const top = {...terminal,side:'top' as const};
    sheet.routes = [
      {id:'r1',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',explicitCircuitId:'c',points:[],boardTerminals:[{boardId:board.id,conductor:'L',endpoint:terminal}],boardPositions:[{boardId:board.id,x:1,y:2}]},
      {id:'r2',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',explicitCircuitId:'c',points:[],boardTerminals:[{boardId:board.id,conductor:'L',endpoint:top}],boardPositions:[{boardId:board.id,x:3,y:4}]},
    ];
    const migrated = migrateLegacyCircuitBoardConnections(doc.data);
    const connection = migrated.circuits[0].boardConnections![0];
    expect(connection.terminals).toEqual([]);
    expect(connection.legacyTerminalConflicts).toEqual([{conductor:'L',endpoints:[terminal,top]}]);
    expect(connection.legacyPositionConflict).toBe(true);
    expect(connection.legacyPositionOptions).toEqual([{x:1,y:2},{x:3,y:4}]);
    expect(migrated.sheets[0].routes).toEqual(sheet.routes);
    expect(() => validateProject({...doc,data:migrated})).not.toThrow();
    const resolved = assignCircuitBoardTerminal(migrated,'c',board.id,'L',top);
    expect(resolved.circuits[0].boardConnections![0].legacyTerminalConflicts).toBeUndefined();
    expect(resolved.circuits[0].protectionDeviceId).toBe(breaker.id);
  });
  it('lets an unassigned historical connection be explicitly adopted without changing its floor drawing', () => {
    const {doc,board,outlet,sheet,terminal} = fixture();
    delete doc.data.circuitBoardMigration;
    sheet.routes = [{id:'old',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',points:[{x:20,y:20},{x:100,y:20},{x:100,y:100}],
      boardTerminals:[{boardId:board.id,conductor:'L',endpoint:terminal}],boardPositions:[{boardId:board.id,x:88,y:99}]}];
    const migrated = migrateLegacyCircuitBoardConnections(doc.data);
    expect(getUnassignedLegacyBoardRoutes(migrated,board.id)).toHaveLength(1);
    const changedAfterMigration = structuredClone(migrated);
    changedAfterMigration.devices.find(device=>device.id===outlet.id)!.circuitId = 'c';
    expect(getUnassignedLegacyBoardRoutes(changedAfterMigration,board.id)).toHaveLength(1);
    const adopted = adoptUnassignedLegacyBoardRoute(migrated,sheet.id,'old',board.id,'c');
    expect(adopted.circuits[0].boardConnections?.[0]).toMatchObject({boardId:board.id,terminals:[{conductor:'L',endpoint:terminal}],position:{x:88,y:99}});
    expect(adopted.sheets[0].routes[0].points).toEqual(sheet.routes[0].points);
    expect(adopted.sheets[0].routes[0].explicitCircuitId).toBeUndefined();
    expect(adopted.sheets[0].routes[0].boardTerminals).toBeUndefined();
    expect(getUnassignedLegacyBoardRoutes(adopted,board.id)).toHaveLength(0);
    expect(() => validateProject({...doc,data:adopted})).not.toThrow();
  });
  it('deletes an associated circuit without resurrecting its legacy connections or deleting the drawing', () => {
    const {doc,board,outlet,sheet,terminal} = fixture();
    delete doc.data.circuitBoardMigration;
    sheet.routes = [{id:'r',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',explicitCircuitId:'c',points:[{x:20,y:20},{x:100,y:20}],
      boardTerminals:[{boardId:board.id,conductor:'L',endpoint:terminal}],boardPositions:[{boardId:board.id,x:88,y:99}]}];
    const deleted = deleteCircuit(migrateLegacyCircuitBoardConnections(doc.data),'c');
    expect(deleted.sheets[0].routes[0].points).toEqual(sheet.routes[0].points);
    expect(deleted.sheets[0].routes[0].boardTerminals).toBeUndefined();
    expect(deleted.sheets[0].routes[0].boardPositions).toBeUndefined();
    expect(getUnassignedLegacyBoardRoutes(deleted,board.id)).toHaveLength(0);
    expect(() => validateProject({...doc,data:deleted})).not.toThrow();
  });
  it('does not destroy an unresolved old terminal when a drawing device later had a circuit deleted', () => {
    const {doc,board,outlet,sheet,terminal} = fixture();
    delete doc.data.circuitBoardMigration;
    sheet.routes = [{id:'r',fromBoardId:board.id,toDeviceId:outlet.id,kind:'power',points:[],
      boardTerminals:[{boardId:board.id,conductor:'L',endpoint:terminal}]}];
    const migrated = migrateLegacyCircuitBoardConnections(doc.data);
    migrated.devices.find(device=>device.id===outlet.id)!.circuitId = 'c';
    const deleted = deleteCircuit(migrated,'c');
    expect(getUnassignedLegacyBoardRoutes(deleted,board.id)).toHaveLength(1);
    expect(deleted.sheets[0].routes[0].boardTerminals).toEqual(sheet.routes[0].boardTerminals);
    expect(() => validateProject({...doc,data:deleted})).not.toThrow();
  });
  it('preserves hidden terminal data, independent positions, protection, and removes invalid deleted references', () => {
    const {doc,board,breaker,terminal} = fixture();
    let next = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    expect(next.circuits[0].protectionDeviceId).toBe(breaker.id);
    next = setCircuitBoardPosition(next,'c',board.id,{x:22,y:77});
    next = setCircuitBoardVisible(next,'c',board.id,false);
    expect(next.circuits[0].boardConnections![0]).toMatchObject({hidden:true,position:{x:22,y:77},terminals:[{conductor:'L',endpoint:terminal}]});
    expect(next.circuits[0].protectionDeviceId).toBe(breaker.id);
    next = setCircuitBoardVisible(next,'c',board.id,true);
    expect(getCircuitBoardConnections(next,board.id)[0].connection.terminals).toHaveLength(1);
    const removed = pruneCircuitBoardConnections(deleteDevice(next,breaker.id));
    expect(removed.circuits[0].boardConnections![0].terminals).toHaveLength(0);
    expect(reconcileAutoProtections(removed).circuits[0].protectionDeviceId).toBeUndefined();
    expect(() => validateProject({...doc,data:removed})).not.toThrow();
  });
  it('deletes only the removed board association while retaining other cabinet circuit data', () => {
    const {doc,board,terminal} = fixture();
    doc.data.boards.push({...structuredClone(board),id:'other',rows:[]});
    let next = assignCircuitBoardTerminal(doc.data,'c',board.id,'L',terminal);
    next = setCircuitBoardVisible(next,'c','other',true);
    next = setCircuitBoardPosition(next,'c','other',{x:100,y:200});
    const removed = deleteBoard(next,board.id);
    expect(removed.circuits[0].boardConnections).toEqual([{boardId:'other',terminals:[],position:{x:100,y:200}}]);
    expect(() => validateProject({...doc,data:removed})).not.toThrow();
  });
});
