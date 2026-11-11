import { t } from '../i18n';
import type { Board, BoardBus, BoardConnection, BoardInfeed, BoardWire, Circuit, Conductor, Device, ProjectData, WiringEndpoint } from '../types';
import { effectiveDevicePoles, getWiringIssues } from './boardWiring';
import { circuitBelongsToBoard } from './circuitBoardAssociation';
import { getBoardConnectionIssues } from './boardConnections';

/** Distinct sides and pole indices are retained even when they share a net. */
export interface TopologyTerminal {
  key: string;
  endpoint: WiringEndpoint;
  conductor?: Conductor;
  netId: string;
  boardId?: string;
  valid: boolean;
}
export interface TopologyCircuitTerminal {
  circuitId: string;
  boardId: string;
  conductor: Conductor;
  endpoint: WiringEndpoint;
  terminalKey: string;
  netId: string;
  valid: boolean;
}
export interface TopologySource {
  boardId: string;
  infeedId?: string;
  deviceId?: string;
  pole: number;
  conductor: Conductor;
  kind: 'supply' | 'earth';
  terminalKey: string;
  netId: string;
}
export interface TopologyNet {
  id: string;
  terminals: TopologyTerminal[];
  circuits: TopologyCircuitTerminal[];
  /** Sources directly connected to this net; no switch is assumed closed. */
  sources: TopologySource[];
  conductors: Conductor[];
  /** True when explicit data joins incompatible conductor functions. */
  conflicted: boolean;
  /** Potential path through known poles, assuming conductive devices are closed. */
  reachable: boolean;
  reachableSources: TopologySource[];
}
export interface TopologyDevicePole {
  pole: number;
  conductor: Conductor;
  top: TopologyTerminal;
  bottom: TopologyTerminal;
  /** A known through-device pole; switch state is not represented. */
  through: boolean;
}
export interface TopologyDevice {
  device: Device;
  boardId?: string;
  /** Product pole count alone does not prove conductor functions or ordering. */
  poleDefinition: 'explicit' | 'product' | 'inferred';
  /** The source role does not specify which device terminal is supplied. */
  sourceSideUnspecified: boolean;
  poles: TopologyDevicePole[];
}
export interface TopologyBus { boardId: string; bus: BoardBus; netId: string; terminals: TopologyTerminal[] }
export interface TopologyInfeed { boardId: string; infeed: BoardInfeed; poles: {pole:number; conductor:Conductor; netId:string; terminal:TopologyTerminal}[] }
export interface TopologyCircuit {
  circuit: Circuit;
  connections: TopologyCircuitTerminal[];
  unresolved: {boardId:string; conductor:Conductor; endpoints:WiringEndpoint[]}[];
}
export interface TopologyWire {
  boardId: string;
  wire: BoardWire;
  from: TopologyTerminal;
  to: TopologyTerminal;
  fromKey: string;
  toKey: string;
  fromNetId: string;
  toNetId: string;
  valid: boolean;
  incompatible: boolean;
}
export interface TopologyLegacy { boardId:string; connection:BoardConnection }
export interface TopologyIssue { boardId:string; code:string; severity:'warning'|'error'; message:string; wireId?:string; busId?:string; deviceId?:string; connectionId?:string }
export interface BoardTopology {
  nets: TopologyNet[];
  devices: TopologyDevice[];
  buses: TopologyBus[];
  infeeds: TopologyInfeed[];
  circuits: TopologyCircuit[];
  wires: TopologyWire[];
  legacy: TopologyLegacy[];
  issues: TopologyIssue[];
}

/** Side is part of identity, unlike the cabinet wiring validation's connectivity key. */
export function topologyEndpointKey(endpoint: WiringEndpoint): string {
  return endpoint.kind === 'device' ? JSON.stringify(['device', endpoint.deviceId, endpoint.side, endpoint.pole])
    : endpoint.kind === 'bus' ? JSON.stringify(['bus', endpoint.busId, endpoint.terminal])
      : JSON.stringify(['infeed', endpoint.infeedId, endpoint.pole]);
}

function conductorsCompatible(a:Conductor,b:Conductor):boolean {
  if (a === b) return true;
  if (a === 'PEN' || b === 'PEN') return ['PEN','PE','N'].includes(a) && ['PEN','PE','N'].includes(b);
  return (a === 'L' && ['L1','L2','L3'].includes(b)) || (b === 'L' && ['L1','L2','L3'].includes(a));
}

/** Only known inline devices may provide an inferred potential path. In
 * particular an SPD, outlet, contactor and unknown custom device cannot be
 * treated as generic top-to-bottom connections without a contact model. */
function hasKnownThroughPoles(device:Device):boolean {
  const role = device.electrical?.role;
  if (role) return ['main','mcb','rccb','rcbo','mpcb','terminal'].includes(role);
  return ['main','breaker','rcd','rcbo'].includes(device.kind);
}

/** Construct a conductor-aware network, keeping electrical nets, the devices
 * between them, historical associations, and unsupported data separate.
 * Wire direction never implies source direction. Infe​ed reachability is a
 * possible path through each known pole, not a guarantee of switch state. */
export function buildBoardTopology(data:ProjectData, boards:Board | Board[]):BoardTopology {
  const selected = Array.isArray(boards) ? boards : [boards];
  const boardIds = new Set(selected.map(board => board.id));
  const allBoards = data.boards;
  const byDevice = new Map(data.devices.map(device => [device.id,device]));
  const deviceBoard = new Map<string,string>();
  for (const board of allBoards) {
    for (const row of board.rows) for (const placement of row.placements) deviceBoard.set(placement.deviceId,board.id);
    for (const device of data.devices) if (!deviceBoard.has(device.id) && device.boardId === board.id && device.moduleWidth !== undefined) deviceBoard.set(device.id,board.id);
  }
  const busBoard = new Map<string,string>(), infeedBoard = new Map<string,string>();
  const busesById = new Map<string,BoardBus>(), infeedsById = new Map<string,BoardInfeed>();
  const devicePoles = new Map(data.devices.map(device => [device.id,effectiveDevicePoles(device)]));
  const extraIssues:TopologyIssue[] = [];
  for (const board of allBoards) {
    for (const bus of board.wiring?.buses ?? []) { busBoard.set(bus.id,board.id); busesById.set(bus.id,bus); }
    for (const source of board.wiring?.infeeds ?? []) { infeedBoard.set(source.id,board.id); infeedsById.set(source.id,source); }
  }
  const terminals = new Map<string,TopologyTerminal>();
  const parent = new Map<string,string>();
  const find = (key:string):string => {
    if (!parent.has(key)) parent.set(key,key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    while (key !== root) { const next = parent.get(key)!; parent.set(key,root); key = next; }
    return root;
  };
  const join = (a:string,b:string) => {
    const ar=find(a), br=find(b);
    if (ar !== br) parent.set(ar < br ? br : ar, ar < br ? ar : br);
  };
  const register = (endpoint:WiringEndpoint):TopologyTerminal => {
    const key = topologyEndpointKey(endpoint), existing=terminals.get(key);
    if (existing) return existing;
    let conductor:Conductor | undefined;
    if (endpoint.kind === 'device') {
      const dev=byDevice.get(endpoint.deviceId);
      if (dev && Number.isInteger(endpoint.pole) && endpoint.pole >= 0 && ['top','bottom'].includes(endpoint.side)) {
        const logical=devicePoles.get(dev.id)?.[endpoint.pole];
        conductor=logical === 'L' ? dev.electrical?.phase ?? logical : logical;
      }
    } else if (endpoint.kind === 'bus') {
      const bus=busesById.get(endpoint.busId);
      if (bus && Number.isInteger(endpoint.terminal) && endpoint.terminal >= 0 && endpoint.terminal < bus.capacity) conductor=bus.conductor;
    } else {
      const source=infeedsById.get(endpoint.infeedId);
      if (source && Number.isInteger(endpoint.pole) && endpoint.pole >= 0) conductor=source.poles[endpoint.pole];
    }
    const boardId = endpoint.kind === 'device' ? deviceBoard.get(endpoint.deviceId)
      : endpoint.kind === 'bus' ? busBoard.get(endpoint.busId) : infeedBoard.get(endpoint.infeedId);
    const value:TopologyTerminal = {key,endpoint,conductor,boardId,valid:!!conductor,netId:''};
    terminals.set(key,value); find(key); return value;
  };

  // Collect every physical endpoint, including those on another board. We
  // need the latter to trace a genuine cross-board feeder without duplicating it.
  const knownDevices = new Set(deviceBoard.keys());
  for (const board of allBoards) for (const wire of board.wiring?.wires ?? [])
    for (const endpoint of [wire.from,wire.to]) if (endpoint.kind === 'device') knownDevices.add(endpoint.deviceId);
  for (const board of allBoards) for (const connection of board.connections ?? []) {
    if (connection.fromDeviceId) knownDevices.add(connection.fromDeviceId);
    knownDevices.add(connection.toDeviceId);
  }
  for (const circuit of data.circuits) for (const connection of circuit.boardConnections ?? [])
    for (const item of connection.terminals) if (item.endpoint.kind === 'device') knownDevices.add(item.endpoint.deviceId);
  for (const id of knownDevices) {
    const device=byDevice.get(id); if (!device) continue;
    const poles=devicePoles.get(id)!;
    poles.forEach((_,pole) => {
      register({kind:'device',deviceId:id,side:'top',pole});
      register({kind:'device',deviceId:id,side:'bottom',pole});
    });
    // A terminal block represents conductive screws. Only explicit groups
    // establish commonality between different logical pole indices.
    if (device.electrical?.role === 'terminal') {
      for (let pole=0;pole<poles.length;pole++)
        join(topologyEndpointKey({kind:'device',deviceId:id,side:'top',pole}),topologyEndpointKey({kind:'device',deviceId:id,side:'bottom',pole}));
      for (const group of device.electrical.commonPoleGroups ?? []) {
        const groupTerminals=group.filter(pole => Number.isInteger(pole) && pole >= 0 && pole < poles.length)
          .map(pole => register({kind:'device',deviceId:id,side:'top',pole}));
        const first=groupTerminals[0];
        for (const terminal of groupTerminals.slice(1)) {
          if (first.conductor && terminal.conductor && conductorsCompatible(first.conductor,terminal.conductor)) join(first.key,terminal.key);
          else if (deviceBoard.get(id) && boardIds.has(deviceBoard.get(id)!)) extraIssues.push({
            boardId:deviceBoard.get(id)!,code:'common-pole-conductor',severity:'error',deviceId:id,
            message:t('{device}: az együtt kezelt kapcsok vezetőfunkciói eltérnek.', {device:device.code})
          });
        }
      }
    }
  }
  for (const board of allBoards) {
    for (const bus of board.wiring?.buses ?? []) {
      const keys=Array.from({length:bus.capacity},(_,terminal) => register({kind:'bus',busId:bus.id,terminal}).key);
      for (const key of keys.slice(1)) join(keys[0],key);
    }
    for (const source of board.wiring?.infeeds ?? [])
      source.poles.forEach((_,pole)=>register({kind:'infeed',infeedId:source.id,pole}));
  }
  const allWires:{boardId:string;wire:BoardWire;from:TopologyTerminal;to:TopologyTerminal}[]=[];
  for (const board of allBoards) for (const wire of board.wiring?.wires ?? []) {
    const from=register(wire.from),to=register(wire.to);
    allWires.push({boardId:board.id,wire,from,to});
    // Keep invalid/incompatible wires in the graph as explicitly erroneous
    // edges, but never merge unlike conductor networks or mark them supplied.
    if (from.conductor && to.conductor && conductorsCompatible(from.conductor,to.conductor)) join(from.key,to.key);
  }
  const circuitItems:{circuit:Circuit;boardId:string;conductor:Conductor;terminal:TopologyTerminal}[]=[];
  for (const circuit of data.circuits) for (const connection of circuit.boardConnections ?? []) {
    if (!allBoards.some(board => board.id === connection.boardId)) continue;
    for (const item of connection.terminals)
      circuitItems.push({circuit,boardId:connection.boardId,conductor:item.conductor,terminal:register(item.endpoint)});
  }

  // Stable net IDs are derived from their lowest endpoint key, not insertion
  // order, so reversing or reordering a wire doesn't change electrical meaning.
  const groups=new Map<string,TopologyTerminal[]>();
  for (const terminal of terminals.values()) { const root=find(terminal.key); const group=groups.get(root) ?? []; group.push(terminal); groups.set(root,group); }
  const nets:TopologyNet[]=[...groups.values()].map(group => {
    group.sort((a,b)=>a.key.localeCompare(b.key));
    const id='net:'+group[0].key;
    for (const terminal of group) terminal.netId=id;
    const conductors=[...new Set(group.flatMap(item => item.conductor ? [item.conductor] : []))];
    return {id,terminals:group,circuits:[],sources:[],conductors,conflicted:false,reachable:false,reachableSources:[]};
  });
  const netById=new Map(nets.map(net=>[net.id,net]));
  const circuitTerminals:TopologyCircuitTerminal[]=circuitItems.map(({circuit,boardId,conductor,terminal}) => {
    const item={circuitId:circuit.id,boardId,conductor,endpoint:terminal.endpoint,terminalKey:terminal.key,netId:terminal.netId,valid:terminal.valid && !!terminal.conductor && conductorsCompatible(conductor,terminal.conductor)};
    const net = netById.get(item.netId)!;
    net.circuits.push(item);
    if (item.valid && !net.conductors.includes(conductor)) net.conductors.push(conductor);
    return item;
  });
  for (const net of nets) {
    // A recorded PEN split can legitimately include PE and N; all other
    // incompatible combinations remain highlighted for inspection.
    const penSplit = net.conductors.includes('PEN') && net.conductors.every(item=>['PEN','PE','N'].includes(item));
    net.conflicted = !penSplit && net.conductors.some((a,index)=>net.conductors.slice(index+1).some(b=>!conductorsCompatible(a,b)));
  }
  const sources:TopologySource[]=[];
  const infeeds:TopologyInfeed[]=allBoards.flatMap(board => (board.wiring?.infeeds ?? []).map(infeed => {
    const poles=infeed.poles.map((conductor,pole) => {
      const terminal=register({kind:'infeed',infeedId:infeed.id,pole});
      if (infeed.kind === 'supply' || conductor === 'PE' || conductor === 'PEN')
        sources.push({boardId:board.id,infeedId:infeed.id,pole,conductor,kind:infeed.kind,terminalKey:terminal.key,netId:terminal.netId});
      return {pole,conductor,netId:terminal.netId,terminal};
    });
    return {boardId:board.id,infeed,poles};
  }));
  const devices:TopologyDevice[]=[...knownDevices].flatMap(id => {
    const device=byDevice.get(id); if (!device || device.kind === 'blank') return [];
    const boardId=deviceBoard.get(id);
    const poleDefinition:TopologyDevice['poleDefinition'] = device.electrical ? 'explicit'
      : device.product?.poles && /^([1-4])P?(\+N)?$/.test(device.product.poles.replace(/\s/g,'').toUpperCase()) ? 'product' : 'inferred';
    // A generic "2P" product count doesn't prove the individual pole
    // functions; never present its inferred L/N assignment as verified.
    const through=hasKnownThroughPoles(device) && poleDefinition === 'explicit';
    const poles=devicePoles.get(id)!.map((conductor,pole)=>({pole,conductor,
      top:register({kind:'device',deviceId:id,side:'top',pole}),
      bottom:register({kind:'device',deviceId:id,side:'bottom',pole}),through}));
    const sourceSideUnspecified=device.electrical?.role === 'supply';
    return [{device,boardId,poleDefinition,sourceSideUnspecified,poles}];
  });
  for (const source of sources) netById.get(source.netId)?.sources.push(source);
  const adjacency=new Map(nets.map(net=>[net.id,new Set<string>()]));
  for (const device of devices) for (const pole of device.poles) if (pole.through && pole.top.netId !== pole.bottom.netId) {
    adjacency.get(pole.top.netId)?.add(pole.bottom.netId);
    adjacency.get(pole.bottom.netId)?.add(pole.top.netId);
  }
  // One connected-component pass, with a shared source list per component;
  // repeated supplies cannot turn traversal into source-count × graph-size.
  const seenNets=new Set<string>();
  for (const net of nets) {
    if (seenNets.has(net.id)) continue;
    const queue=[net.id]; seenNets.add(net.id);
    for (let index=0;index<queue.length;index++) for (const next of adjacency.get(queue[index]) ?? [])
      if (!seenNets.has(next)) { seenNets.add(next); queue.push(next); }
    const reachableSources=queue.flatMap(id=>netById.get(id)?.sources ?? []);
    for (const id of queue) { const current=netById.get(id)!; current.reachable=reachableSources.length > 0; current.reachableSources=reachableSources; }
  }
  const buses:TopologyBus[]=allBoards.flatMap(board => (board.wiring?.buses ?? []).map(bus => {
    const values=Array.from({length:bus.capacity},(_,terminal)=>register({kind:'bus',busId:bus.id,terminal}));
    return {boardId:board.id,bus,netId:values[0]?.netId ?? '',terminals:values};
  }));
  const wires:TopologyWire[]=allWires.filter(item=>boardIds.has(item.boardId) ||
    !!item.from.boardId && boardIds.has(item.from.boardId) || !!item.to.boardId && boardIds.has(item.to.boardId)).map(item=>({
    ...item,fromKey:item.from.key,toKey:item.to.key,fromNetId:item.from.netId,toNetId:item.to.netId,
    valid:item.from.valid && item.to.valid,
    incompatible:!!item.from.conductor && !!item.to.conductor && !conductorsCompatible(item.from.conductor,item.to.conductor)
  }));
  const circuits:TopologyCircuit[]=data.circuits.filter(circuit => selected.some(board => circuitBelongsToBoard(data,circuit,board.id))).map(circuit => ({
    circuit,
    connections:circuitTerminals.filter(item=>item.circuitId === circuit.id && boardIds.has(item.boardId)),
    unresolved:(circuit.boardConnections ?? []).filter(item=>boardIds.has(item.boardId)).flatMap(item=>
      (item.legacyTerminalConflicts ?? []).map(conflict=>({boardId:item.boardId,conductor:conflict.conductor,endpoints:conflict.endpoints})))
  }));
  const legacy:TopologyLegacy[]=selected.flatMap(board=>(board.connections ?? []).map(connection=>({boardId:board.id,connection})));
  // Existing checks are retained as warnings, but do not alter the source graph.
  const issues:TopologyIssue[]=[...extraIssues,...selected.flatMap(board=>[
    ...getWiringIssues(data,board).map(issue=>({...issue,boardId:board.id})),
    ...getBoardConnectionIssues(board,data.devices).map(issue=>({boardId:board.id,code:`legacy-${issue.kind}`,
      severity:'warning' as const,message:issue.message,deviceId:issue.deviceId,connectionId:issue.connectionId}))
  ])];
  for (const circuit of circuits) for (const item of circuit.connections) if (!item.valid) issues.push({
    boardId:item.boardId,code:'circuit-terminal',severity:'error',
    message:t('{circuit}: a(z) {conductor} vezető csatlakozása hiányzik vagy eltérő vezetőfunkciójú.', {circuit:circuit.circuit.code,conductor:item.conductor})
  });
  for (const circuit of circuits) for (const item of circuit.connections) {
    if (!item.valid || !['L','L1','L2','L3'].includes(item.conductor)) continue;
    const hasPhaseSource = netById.get(item.netId)?.reachableSources.some(source=>source.kind === 'supply' &&
      ['L','L1','L2','L3'].includes(source.conductor) && conductorsCompatible(item.conductor,source.conductor));
    if (hasPhaseSource) continue;
    issues.push({boardId:item.boardId,code:'circuit-source-unverified',severity:'warning',
      message:t('{circuit}: a fázisbetáplálás a megadott kapcsolatokból nem követhető.', {circuit:circuit.circuit.code})});
  }
  for (const sheet of data.sheets) for (const route of sheet.routes) for (const boardId of route.legacyUnassignedBoards ?? []) {
    if (boardIds.has(boardId)) issues.push({boardId,code:'legacy-unassigned-circuit',severity:'warning',
      message:t('Egy korábbi elosztóbekötés áramköre nincs tisztázva: {sheet}.', {sheet:sheet.name})});
  }
  const usedEndpoints = [...wires.flatMap(item=>[item.wire.from,item.wire.to]),
    ...circuits.flatMap(item=>item.connections.map(connection=>connection.endpoint))];
  const remoteDevices = new Set([...usedEndpoints.flatMap(endpoint=>endpoint.kind === 'device' ? [endpoint.deviceId] : []),
    ...legacy.flatMap(item=>[item.connection.fromDeviceId,item.connection.toDeviceId].filter((id):id is string=>!!id))]);
  for (const item of devices) if (item.sourceSideUnspecified &&
      (item.boardId && boardIds.has(item.boardId) || remoteDevices.has(item.device.id))) issues.push({
    boardId:item.boardId ?? selected[0]?.id ?? '',code:'source-side-unverified',severity:'warning',deviceId:item.device.id,
    message:t('{device}: a betáplálás kapocsoldala nincs megadva.', {device:item.device.code})
  });
  const remoteBuses = new Set(usedEndpoints.flatMap(endpoint=>endpoint.kind === 'bus' ? [endpoint.busId] : []));
  const remoteSources = new Set(usedEndpoints.flatMap(endpoint=>endpoint.kind === 'infeed' ? [endpoint.infeedId] : []));
  return {nets,devices:devices.filter(item=>!!item.boardId && boardIds.has(item.boardId) || remoteDevices.has(item.device.id)),
    buses:buses.filter(item=>boardIds.has(item.boardId) || remoteBuses.has(item.bus.id)),
    infeeds:infeeds.filter(item=>boardIds.has(item.boardId) || remoteSources.has(item.infeed.id)),circuits,wires,legacy,issues};
}
