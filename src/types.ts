import type { ProductSnapshot } from './products/types';
export type DeviceKind = 'outlet' | 'switch' | 'light' | 'junction' | 'sensor' | 'relay' | 'hub' | 'breaker' | 'rcd' | 'rcbo' | 'spd' | 'main' | 'blank' | 'custom';
export type DeviceVariant = 'switch-double-pole' | 'switch-series' | 'switch-two-way' | 'switch-intermediate' | 'switch-double-two-way' | 'switch-dimmer' | 'switch-push-button' | 'switch-push-button-lit' | 'outlet-double' | 'outlet-weatherproof' | 'outlet-three-phase' | 'light-wall' | 'light-linear' | 'light-led-strip' | 'sensor-motion' | 'sensor-thermostat' | 'custom-tv' | 'custom-data' | 'custom-phone' | 'custom-bell' | 'board-terminal' | 'board-mpcb' | 'board-meter';
export type CatalogGroup = 'switches' | 'outlets' | 'lights' | 'control' | 'connections';
export type DeviceStatus = 'planned' | 'installed' | 'verified';
export type FloorPlanDisplay = 'symbols' | 'images';
export interface Point { x: number; y: number }
export interface Device {
  id: string; code: string; name: string; kind: DeviceKind; room: string;
  variant?: DeviceVariant;
  heightMm: number; model: string; notes: string; status: DeviceStatus;
  circuitId?: string; moduleWidth?: number; rating?: string; photoIds: string[];
  product?: ProductSnapshot; boardId?:string; quantity?:number;
  electrical?: DeviceElectrical;
  /** A dedicated plan image, independent from installation/documentation photos. */
  planImage?: { assetId: string; size: number; opacity: number };
}
export interface Placement extends Point { deviceId: string; rotation: number }
/** Location of an existing distribution board on a drawing sheet. */
export interface FloorBoardPlacement extends Point { boardId: string }
/** Each end refers to exactly one device or distribution board. */
export interface Route { id: string; fromDeviceId?: string; fromBoardId?: string; toDeviceId?: string; toBoardId?: string; kind: 'power' | 'control'; circuitId?: string; explicitCircuitId?: string; boardTerminals?: BoardRouteTerminal[]; boardPositions?: BoardRoutePosition[]; legacyUnassignedBoards?:string[]; points: Point[] }
export interface Annotation extends Point { id: string; text: string; kind?: 'text'; fontSize?: number; color?: string }
export interface PlanSheet { id: string; name: string; width: number; height: number; backgroundAssetId?: string; backgroundOpacity?: number; mmPerUnit?: number; placements: Placement[]; boardPlacements?: FloorBoardPlacement[]; routes: Route[]; annotations: Annotation[] }
export interface Circuit { id: string; code: string; name: string; color: string; protectionDeviceId?: string; protectionAuto?: boolean; notes: string; cable?:string; powerW?:number; loadType?:'socket'|'lamp'|'motor'|'other'; phase?:Phase; conductors?:Conductor[]; cableDetails?:CableDetails; boardConnections?:CircuitBoardConnection[]; hideOnBoards?:boolean }
export interface BoardPlacement { deviceId: string; start: number }
export interface BoardRow { id: string; name: string; capacity: number; placements: BoardPlacement[] }
/** Device-level supply links, independent of floor-plan routes; no individual terminals. */
export interface BoardConnection { id:string; fromDeviceId?:string; toDeviceId:string }
export interface Board { id: string; name: string; rows: BoardRow[]; product?:ProductSnapshot; connections?:BoardConnection[]; supplyLabel?:string; wiring?:BoardWiring }

export type Phase = 'L'|'L1'|'L2'|'L3';
export type Conductor = 'L'|'L1'|'L2'|'L3'|'N'|'PE'|'PEN';
/** Structured electrical data supplements existing names, ratings and product snapshots. */
export interface DeviceElectrical {
  poles: Conductor[]; role?:'supply'|'main'|'mcb'|'rccb'|'rcbo'|'spd'|'contactor'|'meter'|'terminal'|'mpcb'|'outlet';
  phase?:Phase; currentA?:number; curve?:string; residualCurrentMa?:number; residualType?:string; spdClass?:string;
  group?:string;
  /** Left-to-right drawing order as logical pole indices; preserves existing wire endpoints. */
  physicalPoleOrder?:number[];
  /** Screw indices known to be electrically common inside a terminal block. */
  commonPoleGroups?:number[][];
}
export interface CableDetails {
  designation?:string; cores?:number; crossSectionMm2?:number; material?:'Cu'|'Al'; lengthM?:number;
  /** Optional manufacturer resistance; estimates are calculated only when supplied. */
  resistanceOhmPerKm?:number;
}
export type WiringEndpoint =
  | {kind:'device'; deviceId:string; side:'top'|'bottom'; pole:number}
  | {kind:'bus'; busId:string; terminal:number}
  | {kind:'infeed'; infeedId:string; pole:number};
/** The selected cabinet terminal for one conductor of an incoming floor route. */
export interface BoardRouteTerminal { boardId:string; conductor:Conductor; endpoint:WiringEndpoint }
/** An independent position for this route's symbol in each connected board drawing. */
export interface BoardRoutePosition extends Point { boardId:string }
export interface CircuitBoardTerminal { conductor:Conductor; endpoint:WiringEndpoint; points?:Point[] }
export interface CircuitBoardConnection { boardId:string; terminals:CircuitBoardTerminal[]; position?:Point; hidden?:boolean; legacyTerminalConflicts?:{conductor:Conductor; endpoints:WiringEndpoint[]}[]; legacyPositionConflict?:boolean; legacyPositionOptions?:Point[] }
export interface BoardWire {
  id:string; from:WiringEndpoint; to:WiringEndpoint; color?:string; colorPattern?:'green-yellow'; cable?:CableDetails;
  points?:Point[]; label?:string; labelOffset?:Point;
}
export interface BoardBus {
  id:string; name:string; conductor:Conductor; capacity:number; rowId?:string; position:'top'|'bottom';
  terminalLabels:string[]; offset?:Point;
}
export interface BoardInfeed {
  id:string; name:string; kind:'supply'|'earth'; poles:Conductor[]; currentA?:number; cable?:CableDetails; position?:Point; labelOffset?:Point;
}
export interface BoardWiring {
  buses:BoardBus[]; wires:BoardWire[]; infeeds:BoardInfeed[]; demandFactor?:number;
}
export interface Asset { id: string; name: string; mime: string; data: string }
/** Complete data from the embedded distribution-board editor, kept with this project. */
export interface BoardPlannerSnapshot {
  v: number; rev: number; project: Record<string, unknown>; boxes: unknown[]; rows: unknown[];
  comps: Record<string, unknown>[]; wires: unknown[]; bw: unknown[]; bb: unknown[]; stubs: unknown[];
  nid: number; lo?: Record<string, unknown>;
}
export interface ProjectData { id: string; name: string; site: string; client: string; notes: string; sheets: PlanSheet[]; devices: Device[]; circuits: Circuit[]; boards: Board[]; floorPlanDisplay?: FloorPlanDisplay; boardPlanner?: BoardPlannerSnapshot; circuitBoardMigration?:boolean }
export interface Revision { id: string; parentId?: string; createdAt: string; note: string; data: ProjectData; restoredFrom?: string }
export interface ProjectDocument { schemaVersion: 1; data: ProjectData; assets: Record<string, Asset>; revisions: Revision[]; headRevisionId?: string; updatedAt: string; lastExternalSaveAt?: string; lastDriveSaveAt?: string }
export interface ProjectSummary { id: string; name: string; site: string; updatedAt: string }
export interface CatalogEntry { kind: DeviceKind; variant?: DeviceVariant; group?: CatalogGroup; label: string; short: string; category: 'floor' | 'board'; moduleWidth?: number; description: string }
