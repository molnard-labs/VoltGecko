import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { GripHorizontal } from 'lucide-react';
import { t } from '../../i18n';
import { getBoardIssues } from '../../data/boardPlacement';
import { getCircuitBoardConnections } from '../../data/circuitBoard';
import { projectPhases } from '../../data/projectPhases';
import { devicePhysicalPoleOrder, effectiveDevicePoles, endpointConductor, wiringEndpointLabel } from '../../data/boardWiring';
import { automaticWireRoute } from '../../data/boardWireRouting';
import type { RoutingTerminal, WiringObstacle } from '../../data/boardWireRouting';
import { defaultWireColor, GREEN_YELLOW, wireColorAppearance } from '../../data/wireColors';
import { TRACON_PRODUCTS } from '../../products/tracon';
import { SCHNEIDER_PRODUCTS } from '../../products/schneider';
import type {
  Board,
  BoardBus,
  BoardInfeed,
  BoardWire,
  BoardWiring,
  Conductor,
  CircuitBoardConnection,
  Point,
  ProjectData,
  WiringEndpoint
} from '../../types';
import { encodeEndpoint, sameEndpoint } from './endpoints';
import { roundedWirePath } from './wirePath';
import './wire-endpoints.css';
import { moveWireBend, moveWireSegment, orthogonalRoute, removeWireBend, WIRING_GRID_SIZE } from './wireEditing';

// Resolve only bundled catalog images by both manufacturer and reference. The
// catalog uses embedded image data, so the drawing's SVG export remains portable.
const catalogImages = new Map(
  [...TRACON_PRODUCTS, ...SCHNEIDER_PRODUCTS]
    .filter((product) => product.image)
    .map((product) => [`${product.manufacturer}\0${product.reference}`, { image: product.image!, illustrative: !!product.imageIllustrative }])
);

type Drag = {
  kind: 'point' | 'segment' | 'label' | 'bus' | 'infeed' | 'infeed-label' | 'circuit';
  id: string;
  index?: number;
  point: Point;
  delta: Point;
  initialRoute?: Point[];
  clientStart?: Point;
  moved?: boolean;
  viewport?: { x: number; y: number; width: number; height: number };
};
type DeviceDrag = {
  id: string;
  pointerId: number;
  clientStart: Point;
  delta: Point;
  point: Point;
  moved: boolean;
  target?: { rowId: string; start: number };
  viewport: { x: number; y: number; width: number; height: number };
};
interface WiringChanges {
  snapToGrid: boolean;
  patchWire: (id: string, patch: Partial<BoardWire>) => void;
  patchBus: (id: string, patch: Partial<BoardBus>) => void;
  patchInfeed: (id: string, patch: Partial<BoardInfeed>) => void;
  patchCircuitPosition: (circuitId: string, point: Point) => void;
  placeDevice: (deviceId: string, rowId: string, start: number) => void;
}

export function useWiringDiagram(
  data: ProjectData,
  board: Board,
  wiring: BoardWiring,
  { patchWire, patchBus, patchInfeed, patchCircuitPosition, placeDevice, snapToGrid }: WiringChanges
) {
  const [drag, setDragState] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const setDrag = (value: Drag | undefined) => { dragRef.current = value; setDragState(value); };
  const [deviceDrag, setDeviceDrag] = useState<DeviceDrag>();
  const deviceDragRef = useRef<DeviceDrag | undefined>(undefined);
  const svgRef = useRef<SVGSVGElement>(null);
  const cancelDeviceDrag = (eventPointerId?: number) => {
    const pointerId = deviceDragRef.current?.pointerId;
    if (eventPointerId !== undefined && pointerId !== undefined && pointerId !== eventPointerId) return;
    deviceDragRef.current = undefined;
    setDeviceDrag(undefined);
    if (pointerId !== undefined && svgRef.current?.hasPointerCapture(pointerId))
      svgRef.current.releasePointerCapture(pointerId);
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelDeviceDrag();
        setDrag(undefined);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const layoutWidth = Math.max(
    920,
    ...board.rows.map((row) => row.capacity * 46 + 220),
    ...wiring.buses.map((bus) => (bus.offset?.x ?? 80) + bus.capacity * 26 + 100),
    ...wiring.infeeds.map((source) => (source.position?.x ?? 0) + source.poles.length * 26 + 80),
    ...wiring.wires.flatMap((wire) => wire.points?.map((point) => point.x + 70) ?? [])
  );
  const layoutHeight = Math.max(
    450,
    board.rows.length * 230 + 230,
    wiring.infeeds.length * 145 + 110,
    ...wiring.infeeds.map((source) => (source.position?.y ?? 0) + 100),
    ...wiring.buses.map((bus) => (bus.offset?.y ?? 0) + 80),
    ...wiring.wires.flatMap((wire) => wire.points?.map((point) => point.y + 70) ?? [])
  );
  const devicesById = new Map(data.devices.map((device) => [device.id, device]));
  const busesById = new Map(wiring.buses.map((bus) => [bus.id, bus]));
  const infeedsById = new Map(wiring.infeeds.map((source, index) => [source.id, { source, index }]));
  const devicePositions = new Map<string, { x: number; y: number; w: number }>();
  board.rows.forEach((row, index) =>
    row.placements.forEach((placement) => {
      const device = devicesById.get(placement.deviceId);
      if (!device) return;
      const moving = deviceDrag?.moved && deviceDrag.id === device.id ? deviceDrag : undefined;
      const targetRow = moving?.target ? board.rows.findIndex((row) => row.id === moving.target!.rowId) : index;
      devicePositions.set(device.id, {
        x: moving ? moving.target ? 80 + moving.target.start * 46 : moving.point.x : 80 + placement.start * 46,
        y: moving && !moving.target ? moving.point.y : 130 + targetRow * 230,
        w: Math.max(19, (device.moduleWidth ?? 1) * 46 - 4)
      });
    })
  );
  const busOrigin = (bus: BoardBus): Point => {
    const index = board.rows.findIndex((row) => row.id === bus.rowId);
    const original = {
      x: 80,
      y:
        index >= 0
          ? 130 + index * 230 + (bus.position === 'top' ? -56 : 154)
          : bus.position === 'top'
            ? 55
            : layoutHeight - 48
    };
    return drag?.kind === 'bus' && drag.id === bus.id ? drag.point : (bus.offset ?? original);
  };
  const sourceOrigin = (source: BoardInfeed, index: number): Point =>
    drag?.kind === 'infeed' && drag.id === source.id
      ? drag.point
      : (source.position ?? { x: layoutWidth - 160, y: 110 + index * 145 });
  const externalEndpoints = new Map<string, WiringEndpoint>();
  for (const wire of wiring.wires)
    for (const endpoint of [wire.from, wire.to]) {
      const local =
        endpoint.kind === 'device'
          ? devicePositions.has(endpoint.deviceId)
          : endpoint.kind === 'bus'
            ? busesById.has(endpoint.busId)
            : infeedsById.has(endpoint.infeedId);
      if (!local) externalEndpoints.set(encodeEndpoint(endpoint), endpoint);
    }
  const externalKeys = [...externalEndpoints.keys()];
  const endpointPoint = (endpoint: WiringEndpoint): Point => {
    if (endpoint.kind === 'device') {
      const position = devicePositions.get(endpoint.deviceId),
        device = devicesById.get(endpoint.deviceId);
      if (position && device) {
        const order = devicePhysicalPoleOrder(device), count = order.length;
        const physicalPole = endpoint.pole === undefined ? -1 : order.indexOf(endpoint.pole);
        return {
          x: position.x + (physicalPole < 0 || !count ? 0.5 : (physicalPole + 0.5) / count) * position.w,
          y: position.y + (endpoint.side === 'bottom' ? 100 : 0)
        };
      }
    } else if (endpoint.kind === 'bus') {
      const bus = busesById.get(endpoint.busId);
      if (bus) {
        const origin = busOrigin(bus);
        return { x: origin.x + endpoint.terminal * 26 + 13, y: origin.y };
      }
    } else {
      const infeed = infeedsById.get(endpoint.infeedId);
      if (infeed) {
        const origin = sourceOrigin(infeed.source, infeed.index);
        return { x: origin.x + endpoint.pole * 26 + 13, y: origin.y + 42 };
      }
    }
    return { x: layoutWidth - 35, y: 60 + externalKeys.indexOf(encodeEndpoint(endpoint)) * 45 };
  };
  const obstacles: WiringObstacle[] = [
    ...[...devicePositions.values()].map((position) => ({
      x: position.x, y: position.y, width: position.w, height: 100
    })),
    ...wiring.infeeds.map((source, index) => {
      const origin = sourceOrigin(source, index);
      return { x: origin.x - 5, y: origin.y - 8, width: Math.max(90, source.poles.length * 26 + 10), height: 58 };
    })
  ];
  const routingTerminal = (endpoint: WiringEndpoint, other: Point): RoutingTerminal => {
    const point = endpointPoint(endpoint);
    const local = endpoint.kind === 'device' ? devicePositions.has(endpoint.deviceId)
      : endpoint.kind === 'bus' ? busesById.has(endpoint.busId) : infeedsById.has(endpoint.infeedId);
    const direction = !local ? 'left'
      : endpoint.kind === 'device' ? (endpoint.side === 'top' ? 'up' : 'down')
        : endpoint.kind === 'infeed' ? 'down'
          : point.y === other.y ? (point.x < other.x ? 'right' : 'left')
            : point.y < other.y ? 'down' : 'up';
    return { point, direction };
  };
  const routes = new Map<string, Point[]>();
  const route = (wire: BoardWire, _index: number): Point[] => {
    const cached = routes.get(wire.id);
    if (cached) return cached;
    const first = endpointPoint(wire.from), last = endpointPoint(wire.to);
    const storedPoints = wire.points ?? automaticWireRoute(
      routingTerminal(wire.from, last), routingTerminal(wire.to, first), obstacles, wire.id
    ).slice(1, -1);
    // Normalize saved paths visually without mutating project data. This also
    // makes the displayed bend indices match what a later drag will edit.
    const points = wire.points
      ? orthogonalRoute([first, ...storedPoints, last]).slice(1, -1)
      : storedPoints;
    const original = [first, ...points, last];
    const result = drag?.id === wire.id && drag.moved && drag.initialRoute && drag.index !== undefined
      ? drag.kind === 'point' ? moveWireBend(drag.initialRoute, drag.index, drag.point, snapToGrid).route
        : drag.kind === 'segment' ? moveWireSegment(drag.initialRoute, drag.index, drag.point, snapToGrid).route
        : original
      : original;
    routes.set(wire.id, result);
    return result;
  };
  const wireLabelAnchor = (wire: BoardWire, index: number): Point => {
    const points = route(wire, index),
      middle = points[Math.floor(points.length / 2)];
    return { x: middle.x + 9, y: middle.y - 9 };
  };
  const wireLabelPoint = (wire: BoardWire, index: number): Point => {
    const anchor = wireLabelAnchor(wire, index);
    return drag?.kind === 'label' && drag.id === wire.id
      ? drag.point
      : { x: anchor.x + (wire.labelOffset?.x ?? 0), y: anchor.y + (wire.labelOffset?.y ?? 0) };
  };
  const svgPoint = (clientX: number, clientY: number): Point => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  };
  const startDeviceDrag = (event: PointerEvent, id: string) => {
    if (event.button !== 0 || drag || deviceDragRef.current) return;
    const position = devicePositions.get(id);
    if (!position) return;
    event.preventDefault();
    event.stopPropagation();
    const cursor = svgPoint(event.clientX, event.clientY);
    const viewport = svgRef.current!.viewBox.baseVal;
    const value: DeviceDrag = {
      id, pointerId: event.pointerId, clientStart: { x: event.clientX, y: event.clientY },
      delta: { x: position.x - cursor.x, y: position.y - cursor.y },
      point: position, moved: false,
      viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height }
    };
    deviceDragRef.current = value;
    setDeviceDrag(value);
    (event.currentTarget as SVGElement | HTMLElement).focus({ preventScroll: true });
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const moveDeviceDrag = (event: PointerEvent) => {
    const current = deviceDragRef.current;
    if (!current) return false;
    if (current.pointerId !== event.pointerId) return true;
    const moved = current.moved || Math.hypot(event.clientX - current.clientStart.x, event.clientY - current.clientStart.y) >= 5;
    if (!moved) return true;
    const cursor = svgPoint(event.clientX, event.clientY);
    const point = { x: cursor.x + current.delta.x, y: cursor.y + current.delta.y };
    const row = board.rows.find((row, index) =>
      cursor.y >= 115 + index * 230 && cursor.y <= 245 + index * 230 &&
      cursor.x >= 65 && cursor.x <= 95 + row.capacity * 46
    );
    const value = {
      ...current, point, moved,
      target: row ? { rowId: row.id, start: Math.max(0, Math.round((point.x - 80) / 23) / 2) } : undefined
    };
    deviceDragRef.current = value;
    setDeviceDrag(value);
    return true;
  };
  const commitDeviceDrag = (pointerId: number): { handled: boolean; clicked?: string } => {
    const value = deviceDragRef.current;
    if (!value) return { handled: false };
    if (value.pointerId !== pointerId) return { handled: true };
    cancelDeviceDrag();
    if (!value.moved) return { handled: true, clicked: value.id };
    if (value.target) {
      const originalRow = board.rows.find((row) => row.placements.some((placement) => placement.deviceId === value.id));
      const original = originalRow?.placements.find((placement) => placement.deviceId === value.id);
      if (originalRow?.id !== value.target.rowId || original?.start !== value.target.start)
        placeDevice(value.id, value.target.rowId, value.target.start);
    }
    return { handled: true };
  };
  const startDrag = (event: PointerEvent, kind: Drag['kind'], id: string, point: Point, index?: number, initialRoute?: Point[]) => {
    if (event.button !== 0 || deviceDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    const cursor = svgPoint(event.clientX, event.clientY);
    const view = svgRef.current!.viewBox.baseVal;
    const stableViewport = !!initialRoute || kind === 'circuit' || kind === 'infeed';
    setDrag({ kind, id, index, point, delta: { x: point.x - cursor.x, y: point.y - cursor.y },
      ...(initialRoute ? { initialRoute: initialRoute.map(item => ({ ...item })) } : {}),
      ...(stableViewport ? { clientStart: { x: event.clientX, y: event.clientY }, moved: false,
        viewport: { x: view.x, y: view.y, width: view.width, height: view.height } } : {}) });
  };
  const moveDrag = (event: PointerEvent) => {
    const value = dragRef.current;
    if (!value) return;
    const cursor = svgPoint(event.clientX, event.clientY);
    const point = { x: cursor.x + value.delta.x, y: cursor.y + value.delta.y };
    const moved = value.clientStart ? value.moved || Math.hypot(event.clientX - value.clientStart.x, event.clientY - value.clientStart.y) >= 3 : undefined;
    setDrag({ ...value, point, moved });
  };
  const commitDrag = () => {
    const value = dragRef.current;
    if (!value) return;
    setDrag(undefined);
    if (value.kind === 'bus') patchBus(value.id, { offset: value.point });
    else if (value.kind === 'infeed') { if (value.moved) patchInfeed(value.id, { position: value.point }); }
    else if (value.kind === 'circuit') {
      if (value.moved) patchCircuitPosition(value.id, value.point);
    }
    else if (value.kind === 'infeed-label') {
      const index = wiring.infeeds.findIndex((source) => source.id === value.id),
        source = wiring.infeeds[index];
      if (source) {
        const origin = sourceOrigin(source, index);
        patchInfeed(value.id, { labelOffset: { x: value.point.x - origin.x, y: value.point.y - origin.y - 12 } });
      }
    } else {
      const wire = wiring.wires.find((w) => w.id === value.id);
      if (!wire) return;
      const index = wiring.wires.indexOf(wire);
      if (value.kind === 'label') {
        const anchor = wireLabelAnchor(wire, index);
        patchWire(value.id, { labelOffset: { x: value.point.x - anchor.x, y: value.point.y - anchor.y } });
      } else if ((value.kind === 'point' || value.kind === 'segment') && value.initialRoute && value.index !== undefined && value.moved) {
        const moved = value.kind === 'point' ? moveWireBend(value.initialRoute, value.index, value.point, snapToGrid)
          : moveWireSegment(value.initialRoute, value.index, value.point, snapToGrid);
        patchWire(value.id, { points: moved.route.slice(1, -1) });
        return { kind: value.kind, id: value.id, index: moved.index, point: moved.route[moved.index] };
      }
    }
  };
  // Grow the canvas around routes without feeding that size back into default
  // bus/infeed positions. Side gutters may extend beyond the original layout.
  let minX = 0, minY = 0, maxX = layoutWidth, maxY = layoutHeight;
  // Keep overflow reachable without changing the default supply/bus origins.
  devicePositions.forEach((position) => {
    minX = Math.min(minX, position.x - 30);
    minY = Math.min(minY, position.y - 30);
    maxX = Math.max(maxX, position.x + position.w + 50);
    maxY = Math.max(maxY, position.y + 150);
  });
  wiring.wires.forEach((wire, index) => {
    route(wire, index).forEach((point) => {
      minX = Math.min(minX, point.x - 18);
      minY = Math.min(minY, point.y - 18);
      maxX = Math.max(maxX, point.x + 18);
      maxY = Math.max(maxY, point.y + 18);
    });
    const text = wire.label || wire.cable?.designation;
    if (text) {
      const label = wireLabelPoint(wire, index);
      minX = Math.min(minX, label.x - 8);
      minY = Math.min(minY, label.y - 18);
      // Reserve a conservative glyph width before the SVG is mounted, including
      // for dragged labels and labels next to an outer routing gutter.
      maxX = Math.max(maxX, label.x + Array.from(text).length * 12 + 8);
      maxY = Math.max(maxY, label.y + 8);
    }
  });
  // A live preview must not change its own coordinate origin or scroll extent.
  // Circuits belong to the cabinet independently of floor-plan geometry.
  // Their terminals face the cabinet on the left side of each box.
  const boardCircuits = getCircuitBoardConnections(data, board.id);
  const boardCircuitPosition = (circuitId: string, connection: CircuitBoardConnection, index: number): Point => {
    if (drag?.kind === 'circuit' && drag.id === circuitId) return drag.point;
    // Keep the first circuit in the initial horizontal viewport, below the DIN
    // rows. A right-hand gutter would hide every circuit behind horizontal scroll.
    const rowsBottom = board.rows.length ? 130 + (board.rows.length - 1) * 230 + 100 : 80;
    const savedBusY = (bus: BoardBus) => {
      const row = board.rows.findIndex(item => item.id === bus.rowId);
      return bus.offset?.y ?? (row >= 0 ? 130 + row * 230 + (bus.position === 'top' ? -56 : 154)
        : bus.position === 'top' ? 55 : layoutHeight - 48);
    };
    const occupiedBottom = Math.max(rowsBottom,
      ...wiring.buses.map(bus => savedBusY(bus) + 38),
      ...wiring.infeeds.map((source, sourceIndex) => (source.position?.y ?? 110 + sourceIndex * 145) + 58));
    return connection.position ?? { x:100, y:occupiedBottom + 35 + index * 250 };
  };
  for (const [index, item] of boardCircuits.entries()) {
    const position = boardCircuitPosition(item.circuit.id, item.connection, index);
    minX = Math.min(minX, position.x - 100); minY = Math.min(minY, position.y - 25);
    maxX = Math.max(maxX, position.x + 250); maxY = Math.max(maxY, position.y + 260);
  }
  for (const [index, source] of wiring.infeeds.entries()) {
    const origin = sourceOrigin(source, index);
    minX = Math.min(minX, origin.x - 20); minY = Math.min(minY, origin.y - 30);
    maxX = Math.max(maxX, origin.x + Math.max(90, source.poles.length * 26 + 10) + 36);
    maxY = Math.max(maxY, origin.y + 70);
  }
  const viewport = deviceDrag?.viewport ?? drag?.viewport ?? { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const { width, height } = viewport;
  return {
    svgRef,
    snapToGrid,
    drag,
    deviceDrag,
    setDrag,
    width,
    height,
    viewBox: `${viewport.x} ${viewport.y} ${width} ${height}`,
    frame: { x: viewport.x + 8, y: viewport.y + 8, width: width - 16, height: height - 16 },
    devicesById,
    devicePositions,
    busOrigin,
    sourceOrigin,
    externalEndpoints,
    boardCircuits,
    boardCircuitPosition,
    endpointPoint,
    route,
    wireLabelPoint,
    svgPoint,
    startDrag,
    moveDrag,
    patchWire,
    patchInfeed,
    patchCircuitPosition,
    commitDrag,
    startDeviceDrag,
    moveDeviceDrag,
    commitDeviceDrag,
    cancelDeviceDrag
  };
}

type DiagramState = ReturnType<typeof useWiringDiagram>;

/** Decorative device faces use the existing device role; they never imply an electrical connection. */
function DeviceFace({ type, x, y, width }: { type: string; x: number; y: number; width: number }) {
  const cx = x + width / 2;
  const isSwitch = ['breaker', 'mcb', 'rcd', 'rccb', 'rcbo', 'main', 'contactor', 'mpcb'].includes(type);
  return (
    <g className="wiring-device-face" aria-hidden="true" pointerEvents="none">
      <rect className="wiring-device-face-panel" x={x + 3} y={y + 13} width={Math.max(0, width - 6)} height={59} rx={2} />
      {isSwitch ? <>
        <rect className="wiring-device-switch-slot" x={cx - 8} y={y + 38} width={16} height={19} rx={2} />
        <path className="wiring-device-switch" d={`M${cx - 6} ${y + 40}h12l-1.5 12h-9z`} />
        {['rcd', 'rccb', 'rcbo'].includes(type) && width >= 60 && <>
          <circle className="wiring-device-test" cx={cx - 18} cy={y + 47} r={4} />
          <text className="wiring-device-test-label" x={cx - 18} y={y + 49} textAnchor="middle">T</text>
        </>}
      </> : type === 'spd' ? <>
        <rect className="wiring-device-spd-window" x={cx - 9} y={y + 41} width={18} height={10} rx={2} />
        <path className="wiring-device-spd-mark" d={`M${cx - 2} ${y + 42}l-3 5h4l-1 4 5-6h-4l1-3`} />
      </> : type === 'meter' ? <>
        <rect className="wiring-device-display" x={cx - Math.min(17, width / 3)} y={y + 40} width={Math.min(34, width * 2 / 3)} height={14} rx={2} />
        <text className="wiring-device-display-label" x={cx} y={y + 50} textAnchor="middle">kWh</text>
      </> : type === 'terminal' ? <>
        <circle className="wiring-device-terminal-screw" cx={cx} cy={y + 45} r={6} />
        <path className="wiring-device-terminal-mark" d={`M${cx - 3} ${y + 45}h6`} />
      </> : null}
    </g>
  );
}
interface Props {
  data: ProjectData;
  board: Board;
  wiring: BoardWiring;
  diagram: DiagramState;
  from?: WiringEndpoint;
  to?: WiringEndpoint;
  selectedWireId?: string;
  selectedDeviceId: string | null;
  onPlaceDevice: (deviceId: string, rowId: string, start: number) => void;
  onSelectWire: (id: string) => void;
  onSelectDevice: (id: string | null) => void;
  onSelectEndpoint: (endpoint: WiringEndpoint) => void;
  onReconnectEndpoint: (id: string, side: 'from' | 'to', endpoint: WiringEndpoint) => void;
  onNotify: (message: string) => void;
  selectedCircuitConnector?: { circuitId: string; conductor: Conductor };
  onSelectCircuitConnector?: (circuitId: string, conductor: Conductor) => void;
}

export function WiringDiagram({
  data,
  board,
  wiring,
  diagram,
  from,
  to,
  selectedWireId,
  selectedDeviceId,
  onPlaceDevice,
  onSelectWire,
  onSelectDevice,
  onSelectEndpoint,
  onReconnectEndpoint,
  onNotify,
  selectedCircuitConnector,
  onSelectCircuitConnector
}: Props) {
  const pePatternId = `wiring-pe-${useId().replace(/:/g, '')}`;
  const deviceClipId = `wiring-device-${useId().replace(/:/g, '')}`;
  const gridPatternId = `wiring-grid-${useId().replace(/:/g, '')}`;
  const lastCircuitTouch = useRef<{key:string; time:number} | undefined>(undefined);
  const circuitTouchStart = useRef<{key:string; pointerId:number; x:number; y:number} | undefined>(undefined);
  const {
    svgRef,
    snapToGrid,
    drag,
    deviceDrag,
    setDrag,
    width,
    height,
    viewBox,
    frame,
    devicesById,
    devicePositions,
    busOrigin,
    sourceOrigin,
    externalEndpoints,
    boardCircuits,
    boardCircuitPosition,
    endpointPoint,
    route,
    wireLabelPoint,
    svgPoint,
    startDrag,
    moveDrag,
    patchWire,
    patchInfeed,
    patchCircuitPosition,
    commitDrag,
    startDeviceDrag,
    moveDeviceDrag,
    commitDeviceDrag,
    cancelDeviceDrag
  } = diagram;
  const label = (endpoint: WiringEndpoint) => wiringEndpointLabel(data, endpoint);
  const invalidDevices = new Set(getBoardIssues(board, data.devices).map((issue) => issue.deviceId));
  const selectedWire = wiring.wires.find((wire) => wire.id === selectedWireId);
  const selectedRoute = selectedWire ? route(selectedWire, wiring.wires.indexOf(selectedWire)) : [];
  const [selectedBend, setSelectedBend] = useState<{ wireId: string; index: number; point: Point }>();
  useEffect(() => { setSelectedBend(undefined); }, [selectedWireId]);
  // Inserting another point can shift indices. Keep the selection attached to
  // its actual location and never delete an unrelated point after a route edit.
  const selectedBendIndex = (() => {
    if (!selectedBend || selectedBend.wireId !== selectedWireId) return -1;
    const matches = (point: Point | undefined) => point?.x === selectedBend.point.x && point?.y === selectedBend.point.y;
    if (selectedBend.index > 0 && selectedBend.index < selectedRoute.length - 1 && matches(selectedRoute[selectedBend.index])) return selectedBend.index;
    return selectedRoute.findIndex((point, index) => index > 0 && index < selectedRoute.length - 1 && matches(point));
  })();
  const movingBendIndex = drag?.kind === 'point' && drag.moved && drag.initialRoute && drag.index !== undefined
    ? moveWireBend(drag.initialRoute, drag.index, drag.point, snapToGrid).index : selectedBendIndex;
  useEffect(() => {
    const deleteSelectedBend = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || event.defaultPrevented || !selectedWire || selectedBendIndex < 1 || drag || deviceDrag) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
      const oldPoints = selectedRoute.slice(1, -1);
      const nextPoints = removeWireBend(selectedRoute, selectedBendIndex - 1, snapToGrid);
      event.preventDefault();
      if (JSON.stringify(nextPoints) === JSON.stringify(oldPoints)) {
        onNotify(t('A töréspont nem törölhető: a két végpont között legalább egy sarok szükséges.'));
        return;
      }
      patchWire(selectedWire.id, { points: nextPoints });
      setSelectedBend(undefined);
    };
    window.addEventListener('keydown', deleteSelectedBend);
    return () => window.removeEventListener('keydown', deleteSelectedBend);
  }, [selectedWire, selectedBendIndex, selectedRoute, snapToGrid, drag, deviceDrag, patchWire, onNotify]);
  // This drag is separate from bend/device dragging: capturing the pointer on
  // the SVG keeps touch drags working, and hit testing uses screen pixels.
  type EndpointDrag = { id: string; side: 'from' | 'to'; pointerId: number; start: Point; point: Point; moved: boolean };
  const [endpointDrag, setEndpointDrag] = useState<EndpointDrag>();
  const endpointDragRef = useRef<EndpointDrag | undefined>(undefined);
  const stopEndpointDrag = () => {
    const pointerId = endpointDragRef.current?.pointerId;
    endpointDragRef.current = undefined; setEndpointDrag(undefined);
    if (pointerId !== undefined && svgRef.current?.hasPointerCapture(pointerId)) svgRef.current.releasePointerCapture(pointerId);
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') stopEndpointDrag(); };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const visibleEndpoints: WiringEndpoint[] = [
    ...[...devicePositions.keys()].flatMap((id) => {
      const device = devicesById.get(id)!;
      if (device.kind === 'blank') return [];
      return (['top', 'bottom'] as const).flatMap((side) =>
        effectiveDevicePoles(device).map((_, pole): WiringEndpoint => ({ kind: 'device', deviceId: id, side, pole })));
    }),
    ...wiring.buses.flatMap((bus) => Array.from({ length: bus.capacity }, (_, terminal): WiringEndpoint => ({ kind: 'bus', busId: bus.id, terminal }))),
    ...wiring.infeeds.flatMap((source) => source.poles.map((_, pole): WiringEndpoint => ({ kind: 'infeed', infeedId: source.id, pole }))),
    ...externalEndpoints.values()
  ];
  const localVisibleEndpoint = (endpoint: WiringEndpoint) =>
    !externalEndpoints.has(encodeEndpoint(endpoint)) && visibleEndpoints.some(item => sameEndpoint(item, endpoint));
  const circuitConductors = (connections: { conductor: Conductor }[]): Conductor[] => {
    const hasPen = wiring.infeeds.some(infeed => infeed.poles.includes('PEN')) ||
      wiring.buses.some(bus => bus.conductor === 'PEN') ||
      [...devicePositions.keys()].some(id => effectiveDevicePoles(devicesById.get(id)!).includes('PEN'));
    const candidates: Conductor[] = [...projectPhases(data), 'N', 'PE'];
    if (hasPen) candidates.push('PEN');
    for (const connection of connections) if (!candidates.includes(connection.conductor)) candidates.push(connection.conductor);
    return candidates;
  };
  const endpointAt = (clientX: number, clientY: number): WiringEndpoint | undefined => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return undefined;
    let closest: WiringEndpoint | undefined, distance = 22;
    for (const endpoint of visibleEndpoints) {
      const point = endpointPoint(endpoint);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const nextDistance = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (nextDistance < distance) { closest = endpoint; distance = nextDistance; }
    }
    return closest;
  };
  const startEndpointDrag = (event: PointerEvent, side: 'from' | 'to') => {
    if (event.button !== 0 || !selectedWire || drag || deviceDrag) return;
    event.preventDefault(); event.stopPropagation();
    const value: EndpointDrag = { id: selectedWire.id, side, pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY }, point: endpointPoint(selectedWire[side]), moved: false };
    endpointDragRef.current = value; setEndpointDrag(value);
    svgRef.current?.setPointerCapture(event.pointerId);
  };
  const moveEndpointDrag = (event: PointerEvent): boolean => {
    const current = endpointDragRef.current;
    if (!current) return false;
    if (current.pointerId !== event.pointerId) return true;
    const moved = current.moved || Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) >= 5;
    if (moved) { const value = { ...current, moved, point: svgPoint(event.clientX, event.clientY) }; endpointDragRef.current = value; setEndpointDrag(value); }
    return true;
  };
  const finishEndpointDrag = (event: PointerEvent): boolean => {
    const current = endpointDragRef.current;
    if (!current) return false;
    if (current.pointerId !== event.pointerId) return true;
    const target = current.moved ? endpointAt(event.clientX, event.clientY) : undefined;
    stopEndpointDrag();
    if (target) onReconnectEndpoint(current.id, current.side, target);
    else if (!current.moved) {
      const wire = wiring.wires.find((item) => item.id === current.id);
      if (wire) onSelectEndpoint(wire[current.side]);
    }
    return true;
  };
  const hasIllustrativeImage = [...devicePositions.keys()].some((id) => {
    const product = devicesById.get(id)?.product;
    return product && catalogImages.get(`${product.manufacturer}\0${product.reference}`)?.illustrative;
  });
  const terminal = (endpoint: WiringEndpoint, point: Point, text: string) => {
    const selected = (from && sameEndpoint(from, endpoint)) || (to && sameEndpoint(to, endpoint)),
      appearance = wireColorAppearance(defaultWireColor(endpointConductor(data, endpoint) ?? 'L')),
      color = appearance.stripe ? `url(#${pePatternId})` : appearance.color;
    return (
      <g
        key={encodeEndpoint(endpoint)}
        className={`wiring-terminal ${selected ? 'selected' : ''}`}
        role="button"
        tabIndex={0}
        aria-label={label(endpoint)}
        onClick={(e) => {
          e.stopPropagation();
          onSelectEndpoint(endpoint);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectEndpoint(endpoint);
          }
        }}
      >
        <title>{label(endpoint)}</title>
        <circle className="wiring-terminal-hit" cx={point.x} cy={point.y} r={14} fill="transparent" />
        <circle cx={point.x} cy={point.y} r={8} fill={color} />
        <text x={point.x} y={point.y + (endpoint.kind === 'device' && endpoint.side === 'bottom' ? 21 : -12)} textAnchor="middle">
          {text}
        </text>
      </g>
    );
  };
  return (
    <div className="wiring-diagram-scroll">
      <svg
        ref={svgRef}
        className="wiring-diagram"
        width={width}
        height={height}
        viewBox={viewBox}
        aria-label={t('Elosztó részletes huzalozási rajza')}
        onPointerMove={(event) => {
          if (moveEndpointDrag(event)) return;
          if (!moveDeviceDrag(event) && drag) moveDrag(event);
        }}
        onPointerUp={(event) => {
          if (finishEndpointDrag(event)) return;
          const completed = commitDeviceDrag(event.pointerId);
          if (completed.clicked) onSelectDevice(completed.clicked);
          if (!completed.handled) {
            const moved = commitDrag();
            if (moved?.kind === 'point') setSelectedBend({ wireId: moved.id, index: moved.index, point: moved.point });
          }
        }}
        onPointerCancel={(event) => {
          if (endpointDragRef.current?.pointerId === event.pointerId) stopEndpointDrag();
          cancelDeviceDrag(event.pointerId);
          if (!deviceDrag) setDrag(undefined);
        }}
        onLostPointerCapture={(event) => { if (endpointDragRef.current?.pointerId === event.pointerId) stopEndpointDrag(); cancelDeviceDrag(event.pointerId); }}
      >
        <defs>
          <pattern id={gridPatternId} width={WIRING_GRID_SIZE} height={WIRING_GRID_SIZE} patternUnits="userSpaceOnUse">
            <circle cx={0} cy={0} r={0.8} fill="#90a59b" />
          </pattern>
          <pattern id={pePatternId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={8} height={8} fill={GREEN_YELLOW.green} />
            <rect width={4} height={8} fill={GREEN_YELLOW.yellow} />
          </pattern>
        </defs>
        <rect className="wiring-cabinet-frame" {...frame} rx={12} />
        <rect className="wiring-cabinet-inset" x={frame.x + 14} y={frame.y + 14} width={frame.width - 28} height={frame.height - 28} rx={6} />
        {snapToGrid && <rect data-testid="wiring-grid" {...frame} rx={12} fill={`url(#${gridPatternId})`} opacity={0.5} pointerEvents="none" />}
        {board.rows.map((row, index) => (
          <g key={row.id}>
            <rect
              className={`wiring-row ${deviceDrag?.moved && deviceDrag.target?.rowId === row.id ? 'wiring-device-drop-target' : ''}`}
              x={65}
              y={115 + index * 230}
              width={row.capacity * 46 + 30}
              height={130}
              rx={8}
            />
            <rect className="wiring-din-rail" x={65} y={166 + index * 230} width={row.capacity * 46 + 30} height={28} rx={2} />
            {Array.from({ length: Math.ceil(row.capacity) }, (_, module) => (
              <g key={module} aria-hidden="true">
                <line className="wiring-module-tick" x1={80 + module * 46} x2={80 + module * 46} y1={119 + index * 230} y2={241 + index * 230} />
                <text className="wiring-module-number" x={101 + module * 46} y={263 + index * 230} textAnchor="middle">{module + 1}</text>
              </g>
            ))}
            <text className="wiring-row-label" x={80} y={100 + index * 230}>
              {row.name} · {row.capacity} M
            </text>
          </g>
        ))}
        {boardCircuits.map(({ circuit, connection }, index) => {
          const origin = boardCircuitPosition(circuit.id, connection, index);
          const conductors = circuitConductors([...connection.terminals, ...(connection.legacyTerminalConflicts ?? [])]);
          return <g key={'circuit-links-' + circuit.id} aria-hidden="true" pointerEvents="none">
            {connection.terminals.map(item => {
              if (!localVisibleEndpoint(item.endpoint)) return null;
              const wireIndex = conductors.indexOf(item.conductor);
              const start = {x:origin.x, y:origin.y + 62 + wireIndex * 24};
              const end = endpointPoint(item.endpoint);
              const midX = origin.x - 20 - wireIndex * 8;
              const points = [start.x+','+start.y,midX+','+start.y,midX+','+end.y,end.x+','+end.y].join(' ');
              const appearance = wireColorAppearance(defaultWireColor(item.conductor));
              return <g key={item.conductor} data-circuit-link={circuit.id} data-conductor={item.conductor}>
                <polyline points={points} fill="none" stroke="#fff" strokeWidth={7} strokeLinejoin="round" />
                <polyline points={points} fill="none" stroke={appearance.color} strokeWidth={3} strokeDasharray="8 5" strokeLinejoin="round" />
                {appearance.stripe && <polyline points={points} fill="none" stroke={appearance.stripe} strokeWidth={3} strokeDasharray="4 9" strokeLinejoin="round" />}
              </g>;
            })}
          </g>;
        })}
        {boardCircuits.map(({ circuit, connection }, index) => {
          const origin = boardCircuitPosition(circuit.id, connection, index);
          const conductors = circuitConductors([...connection.terminals, ...(connection.legacyTerminalConflicts ?? [])]);
          const height = Math.max(90, 72 + conductors.length * 24);
          const circuitLabel = circuit.code + ' · ' + circuit.name;
          return <g key={'circuit-box-' + circuit.id} className="wiring-circuit" data-circuit-id={circuit.id}>
            <title>{circuitLabel}</title>
            <rect x={origin.x} y={origin.y} width={230} height={height} rx={6} fill="#f3f8f5" stroke="#638a74" />
            <text x={origin.x + 18} y={origin.y + 22} fontSize={13} fontWeight={600} fill="#174f3d">{circuit.code}</text>
            <text x={origin.x + 18} y={origin.y + 40} fontSize={12} fill="#365746">{circuit.name.length > 24 ? circuit.name.slice(0, 23) + '…' : circuit.name}</text>
            {(connection.legacyTerminalConflicts?.length || connection.legacyPositionConflict) && <text x={origin.x + 185} y={origin.y + 22} fontSize={14} fontWeight={700} fill="#a52f20"><title>{t('Korábbi kapcsolatok eltérnek; ellenőrizd az áramkör beállításait.')}</title>!</text>}
            <foreignObject className="wiring-device-grip-container" x={origin.x + 200} y={origin.y + 5} width={24} height={20}>
              <button type="button" className="wiring-device-grip" aria-label={t('Áramkör mozgatása: {route}', {route:circuitLabel})}
                onPointerDown={event => { event.currentTarget.focus({preventScroll:true}); startDrag(event, 'circuit', circuit.id, origin); }}
                onClick={event => { event.preventDefault(); event.stopPropagation(); }}
                onKeyDown={event => {
                  const step = snapToGrid ? WIRING_GRID_SIZE : 1;
                  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                  if (!dx && !dy) return;
                  event.preventDefault(); event.stopPropagation();
                  patchCircuitPosition(circuit.id, {x:origin.x + dx, y:origin.y + dy});
                }}><GripHorizontal aria-hidden="true" width={16} height={16}/></button>
            </foreignObject>
            {conductors.map((conductor, wireIndex) => {
              const terminal = connection.terminals.find(item => item.conductor === conductor);
              const visible = terminal ? localVisibleEndpoint(terminal.endpoint) : true;
              const active = selectedCircuitConnector?.circuitId === circuit.id && selectedCircuitConnector.conductor === conductor;
              const x = origin.x, y = origin.y + 62 + wireIndex * 24;
              const conflict = connection.legacyTerminalConflicts?.some(item => item.conductor === conductor);
              const title = t('{conductor} · {circuit}: áramköri végpont', { conductor, circuit:circuitLabel });
              const select = () => onSelectCircuitConnector?.(circuit.id, conductor);
              const touchKey = JSON.stringify([circuit.id, conductor]);
              return <g key={conductor} role="button" tabIndex={0} aria-label={title} className={'wiring-circuit-connector' + (active ? ' selected' : '')} data-conductor={conductor}
                onPointerDown={event => {
                  if (event.pointerType === 'touch') circuitTouchStart.current = {key:touchKey,pointerId:event.pointerId,x:event.clientX,y:event.clientY};
                }}
                onPointerUp={event => {
                  if (event.pointerType !== 'touch') return;
                  const start = circuitTouchStart.current; circuitTouchStart.current = undefined;
                  event.preventDefault(); event.stopPropagation();
                  lastCircuitTouch.current = {key:touchKey,time:Date.now()};
                  if (start?.key === touchKey && start.pointerId === event.pointerId && Math.hypot(event.clientX-start.x,event.clientY-start.y) <= 8) select();
                }}
                onPointerCancel={() => { circuitTouchStart.current = undefined; }}
                onClick={event => {
                  event.stopPropagation();
                  if (lastCircuitTouch.current?.key === touchKey && Date.now() - lastCircuitTouch.current.time < 750) return;
                  select();
                }}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(); } }}>
                <title>{terminal ? title + ' · ' + (visible ? label(terminal.endpoint) : t('Kapocs nem látható a rajzon')) : title}</title>
                <circle cx={x} cy={y} r={14} fill="transparent" />
                <circle cx={x} cy={y} r={active ? 8 : 6} fill={terminal ? (visible ? '#276b50' : '#bf432c') : '#fff'} stroke={active ? '#ed9700' : conflict ? '#bf432c' : '#276b50'} strokeWidth={active || conflict ? 3 : 2} />
                <text x={x + 14} y={y + 4} textAnchor="start" fontSize={11} fontWeight={700} fill={visible && !conflict ? '#174f3d' : '#a52f20'} pointerEvents="none">{conductor}{visible && !conflict ? '' : '!'}</text>
              </g>;
            })}
          </g>;
        })}
        {wiring.wires.map((wire, index) => {
          const currentRoute = route(wire, index).map((point, routeIndex, all) =>
            endpointDrag?.id === wire.id && endpointDrag.moved && ((endpointDrag.side === 'from' && routeIndex === 0) || (endpointDrag.side === 'to' && routeIndex === all.length - 1)) ? endpointDrag.point : point);
          const points = currentRoute.map((point) => `${point.x},${point.y}`).join(' ');
          const appearance = wireColorAppearance(wire, endpointConductor(data, wire.from) ?? 'L');
          const path = roundedWirePath(currentRoute);
          return (
            <g key={wire.id} className={`wiring-wire ${selectedWireId === wire.id ? 'selected' : ''}`}>
              <polyline
                className="wiring-wire-hit"
                points={points}
                onClick={() => onSelectWire(wire.id)}
                role="button"
                tabIndex={0}
                aria-label={t('Vezeték: {from} → {to}', { from: label(wire.from), to: label(wire.to) })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectWire(wire.id);
                  }
                }}
              />
              <path className="wiring-wire-outline" d={path} />
              <path
                className="wiring-wire-line"
                d={path}
                stroke={appearance.color}
              />
              {appearance.stripe && (
                <path
                  className="wiring-wire-line wiring-wire-stripe"
                  d={path}
                  stroke={appearance.stripe}
                  strokeDasharray="7 7"
                />
              )}
            </g>
          );
        })}
        {[...devicePositions].map(([id, position], deviceIndex) => {
          const device = devicesById.get(id)!;
          const dragging = deviceDrag?.moved && deviceDrag.id === id;
          const invalid = invalidDevices.has(id) || (dragging && !deviceDrag.target);
          const type = device.electrical?.role ?? device.kind;
          const productImage = device.product
            ? catalogImages.get(`${device.product.manufacturer}\0${device.product.reference}`) : undefined;
          const typeLabel = ({ breaker: 'MCB', mcb: 'MCB', rcd: 'RCD', rccb: 'RCCB', rcbo: 'RCBO', spd: 'SPD', main: 'MAIN', terminal: 'XT', meter: 'kWh', contactor: 'KM', mpcb: 'MPCB', blank: '—' } as Record<string, string>)[type] ?? type.toUpperCase();
          const clipId = `${deviceClipId}-${deviceIndex}`;
          return (
            <g key={id} data-device-id={id} className={`wiring-device-group ${dragging ? 'wiring-device-dragging' : ''}`}>
              <rect
                className={`wiring-device ${selectedDeviceId === id ? 'selected' : ''} ${invalid ? 'invalid' : ''} ${device.kind === 'blank' ? 'blank' : ''}`}
                x={position.x}
                y={position.y}
                width={position.w}
                height={100}
                rx={4}
                onClick={() => onSelectDevice(id)}
                role="button"
                tabIndex={0}
                aria-label={t('Készülék szerkesztése: {code}', { code: device.code })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectDevice(id); }
                }}
              ><title>{[device.code, device.name, device.rating || typeLabel, device.electrical?.group].filter(Boolean).join(' · ')}</title></rect>
              <clipPath id={clipId}><rect x={position.x + 3} y={position.y + 15} width={position.w - 6} height={58} /></clipPath>
              <g clipPath={`url(#${clipId})`}>
              {productImage ? <image href={productImage.image} x={position.x + 4} y={position.y + 29} width={position.w - 8} height={32} preserveAspectRatio="xMidYMid meet" pointerEvents="none" /> : device.kind !== 'blank' && <DeviceFace type={type} x={position.x} y={position.y} width={position.w} />}
              {productImage?.illustrative && <text x={position.x + position.w - 5} y={position.y + 26} textAnchor="end" fontSize={11} fontWeight={700} fill="#1b563e" pointerEvents="none"><title>{t('Termékcsalád illusztrációja')}</title>I</text>}
              <text
                className="wiring-device-code"
                x={position.x + position.w / 2}
                y={position.y + 25}
                textAnchor="middle"
              >
                {device.code}
              </text>
              <text
                className="wiring-device-rating"
                x={position.x + position.w / 2}
                y={position.y + 69}
                textAnchor="middle"
              >
                {device.rating || '—'}
              </text>
              {!productImage && <text className="wiring-device-type" x={position.x + position.w / 2} y={position.y + 36} textAnchor="middle"><title>{[typeLabel, device.electrical?.group].filter(Boolean).join(' · ')}</title>{device.electrical?.group || typeLabel}</text>}
              </g>
              <foreignObject className="wiring-device-grip-container" x={position.x + 4} y={position.y + 74} width={position.w - 8} height={20}>
              <button
                type="button"
                className="wiring-device-grip"
                data-device-id={id}
                aria-label={t('Készülék mozgatása: {code}', { code: device.code })}
                onPointerDown={(event) => { startDeviceDrag(event, id); onSelectDevice(null); }}
                onClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); onSelectDevice(id);
                  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                    event.preventDefault(); event.stopPropagation();
                    const rowIndex = board.rows.findIndex((row) => row.placements.some((placement) => placement.deviceId === id));
                    const placement = board.rows[rowIndex]?.placements.find((placement) => placement.deviceId === id);
                    const target = board.rows[rowIndex + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)];
                    if (placement && target) onPlaceDevice(id, target.id, Math.max(0, placement.start + (event.key === 'ArrowLeft' ? -0.5 : event.key === 'ArrowRight' ? 0.5 : 0)));
                  }
                }}
              >
                <GripHorizontal aria-hidden="true" width={16} height={16} />
              </button>
              </foreignObject>
              {device.kind !== 'blank' &&
                (['top', 'bottom'] as const).flatMap((side) =>
                  devicePhysicalPoleOrder(device).map((index) =>
                    terminal(
                      { kind: 'device', deviceId: id, side, pole: index },
                      endpointPoint({ kind: 'device', deviceId: id, side, pole: index }),
                      effectiveDevicePoles(device)[index]
                    )
                  )
                )}
            </g>
          );
        })}
        {wiring.buses.map((bus) => {
          const origin = busOrigin(bus);
          return (
            <g key={bus.id}>
              <rect
                className="wiring-bus"
                x={origin.x}
                y={origin.y - 5}
                width={bus.capacity * 26}
                height={10}
                fill={bus.conductor === 'PE' ? `url(#${pePatternId})` : defaultWireColor(bus.conductor).color}
              />
              <text
                className="wiring-move-label"
                x={origin.x}
                y={origin.y + 29}
                onPointerDown={(event) => startDrag(event, 'bus', bus.id, origin)}
              >
                {bus.name} · {bus.conductor}
              </text>
              {Array.from({ length: bus.capacity }, (_, terminalIndex) =>
                terminal(
                  { kind: 'bus', busId: bus.id, terminal: terminalIndex },
                  endpointPoint({ kind: 'bus', busId: bus.id, terminal: terminalIndex }),
                  bus.terminalLabels[terminalIndex] || String(terminalIndex + 1)
                )
              )}
            </g>
          );
        })}
        {wiring.infeeds.map((source, index) => {
          const origin = sourceOrigin(source, index),
            sourceWidth = Math.max(90, source.poles.length * 26 + 10),
            position =
              drag?.kind === 'infeed-label' && drag.id === source.id
                ? drag.point
                : { x: origin.x + (source.labelOffset?.x ?? 0), y: origin.y + 12 + (source.labelOffset?.y ?? 0) };
          return (
            <g key={source.id}>
              <rect
                className="wiring-source"
                x={origin.x - 5}
                y={origin.y - 8}
                width={sourceWidth}
                height={58}
                rx={5}
                onPointerDown={(event) => startDrag(event, 'infeed', source.id, origin)}
              />
              <text
                className="wiring-move-label"
                x={position.x}
                y={position.y}
                onPointerDown={(event) => startDrag(event, 'infeed-label', source.id, position)}
              >
                {source.name}{source.currentA !== undefined ? ` · ${source.currentA} A` : ''}
              </text>
              <foreignObject className="wiring-device-grip-container" x={origin.x + sourceWidth + 3} y={origin.y + 8} width={24} height={20}>
                <button type="button" className="wiring-device-grip" aria-label={t('Betáplálás mozgatása: {name}', {name:source.name})}
                  onPointerDown={event => { event.currentTarget.focus({preventScroll:true}); startDrag(event, 'infeed', source.id, origin); }}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); }}
                  onKeyDown={event => {
                    const step = snapToGrid ? WIRING_GRID_SIZE : 1;
                    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                    if (!dx && !dy) return;
                    event.preventDefault(); event.stopPropagation();
                    patchInfeed(source.id, {position:{x:origin.x + dx,y:origin.y + dy}});
                  }}><GripHorizontal aria-hidden="true" width={16} height={16}/></button>
              </foreignObject>
              {source.poles.map((pole, poleIndex) =>
                terminal(
                  { kind: 'infeed', infeedId: source.id, pole: poleIndex },
                  endpointPoint({ kind: 'infeed', infeedId: source.id, pole: poleIndex }),
                  pole
                )
              )}
            </g>
          );
        })}
        {[...externalEndpoints].map(([key, endpoint]) => {
          const point = endpointPoint(endpoint);
          return (
            <g key={key}>
              {terminal(endpoint, point, '↗')}
              <text x={point.x - 14} y={point.y + 5} textAnchor="end">
                {label(endpoint)}
              </text>
            </g>
          );
        })}
        {wiring.wires.map((wire, index) => {
          const position = wireLabelPoint(wire, index),
            text = wire.label || wire.cable?.designation;
          return text ? (
            <text
              key={wire.id}
              className="wiring-wire-label"
              x={position.x}
              y={position.y}
              onClick={() => onSelectWire(wire.id)}
              onPointerDown={(event) => startDrag(event, 'label', wire.id, position)}
            >
              {text}
            </text>
          ) : null;
        })}
        {hasIllustrativeImage && <text x={frame.x + 18} y={frame.y + 27} fontSize={13} fill="#365746"><title>{t('Termékcsalád illusztrációja')}</title>{t('I: termékcsalád illusztrációja')}</text>}
        {selectedWire && selectedRoute.slice(0, -1).map((point, index) => {
          const next = selectedRoute[index + 1];
          if (point.x === next.x && point.y === next.y) return null;
          return <line key={index} className={`wiring-segment-handle ${point.y === next.y ? 'horizontal' : 'vertical'}`}
            data-testid={`wire-segment-${index}`} x1={point.x} y1={point.y} x2={next.x} y2={next.y}
            role="button" tabIndex={0} aria-label={t('{number}. vezetékszakasz mozgatása', { number: index + 1 })}
            onKeyDown={(event) => {
              const horizontal = point.y === next.y;
              const direction = horizontal ? (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)
                : (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
              if (!direction) return;
              event.preventDefault();
              const delta = direction * (snapToGrid ? WIRING_GRID_SIZE : 1);
              const center = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
              const target = horizontal ? { ...center, y: center.y + delta } : { ...center, x: center.x + delta };
              patchWire(selectedWire.id, { points: moveWireSegment(selectedRoute, index, target, snapToGrid).route.slice(1, -1) });
              setSelectedBend(undefined);
            }}
            onPointerDown={(event) => {
              setSelectedBend(undefined);
              startDrag(event, 'segment', selectedWire.id, { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }, index, selectedRoute);
            }} />;
        })}
        {selectedWire && (['from', 'to'] as const).map((side) => {
          const point = endpointDrag?.id === selectedWire.id && endpointDrag.side === side && endpointDrag.moved
            ? endpointDrag.point : endpointPoint(selectedWire[side]);
          return <circle key={side} className="wiring-endpoint-handle" data-testid={`wire-endpoint-${side}`}
            cx={point.x} cy={point.y} r={11} onPointerDown={(event) => startEndpointDrag(event, side)}
            aria-label={t(side === 'from' ? 'Vezeték kezdőpontjának áthúzása' : 'Vezeték végpontjának áthúzása')}>
            <title>{t('Húzd át a vezeték végét egy másik csatlakozópontra.')}</title>
          </circle>;
        })}
        {selectedWire &&
          selectedRoute
            .slice(1, -1)
            .map((point, index) => (
              <circle
                className={`wiring-route-handle ${movingBendIndex === index + 1 ? 'selected' : ''}`}
                data-testid={`wire-bend-${index}`}
                key={index}
                cx={point.x}
                cy={point.y}
                r={7}
                role="button" tabIndex={0}
                aria-label={t('{number}. töréspont kijelölése', { number: index + 1 })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault(); setSelectedBend({ wireId: selectedWire.id, index: index + 1, point });
                    return;
                  }
                  const step = snapToGrid ? WIRING_GRID_SIZE : 1;
                  const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
                  const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
                  if (!dx && !dy) return;
                  event.preventDefault();
                  const moved = moveWireBend(selectedRoute, index + 1, { x: point.x + dx, y: point.y + dy }, snapToGrid);
                  patchWire(selectedWire.id, { points: moved.route.slice(1, -1) });
                  setSelectedBend({ wireId: selectedWire.id, index: moved.index, point: moved.route[moved.index] });
                }}
                onPointerDown={(event) => {
                  event.currentTarget.focus({ preventScroll: true });
                  setSelectedBend({ wireId: selectedWire.id, index: index + 1, point });
                  startDrag(event, 'point', selectedWire.id, point, index + 1, selectedRoute);
                }}
              />
            ))}
      </svg>
    </div>
  );
}
