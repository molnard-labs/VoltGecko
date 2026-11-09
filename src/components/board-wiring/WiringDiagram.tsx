import { useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { GripHorizontal } from 'lucide-react';
import { t } from '../../i18n';
import { getBoardIssues } from '../../data/boardPlacement';
import { effectiveDevicePoles, endpointConductor, wiringEndpointLabel } from '../../data/boardWiring';
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
  Point,
  ProjectData,
  WiringEndpoint
} from '../../types';
import { encodeEndpoint, sameEndpoint } from './endpoints';
import { roundedWirePath } from './wirePath';

// Resolve only bundled catalog images by both manufacturer and reference. The
// catalog uses embedded image data, so the drawing's SVG export remains portable.
const catalogImages = new Map(
  [...TRACON_PRODUCTS, ...SCHNEIDER_PRODUCTS]
    .filter((product) => product.image)
    .map((product) => [`${product.manufacturer}\0${product.reference}`, { image: product.image!, illustrative: !!product.imageIllustrative }])
);

type Drag = {
  kind: 'point' | 'label' | 'bus' | 'infeed' | 'infeed-label';
  id: string;
  index?: number;
  point: Point;
  delta: Point;
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
  patchWire: (id: string, patch: Partial<BoardWire>) => void;
  patchBus: (id: string, patch: Partial<BoardBus>) => void;
  patchInfeed: (id: string, patch: Partial<BoardInfeed>) => void;
  placeDevice: (deviceId: string, rowId: string, start: number) => void;
}

export function useWiringDiagram(
  data: ProjectData,
  board: Board,
  wiring: BoardWiring,
  { patchWire, patchBus, patchInfeed, placeDevice }: WiringChanges
) {
  const [drag, setDrag] = useState<Drag>();
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
        const count = effectiveDevicePoles(device).length;
        return {
          x: position.x + (endpoint.pole === undefined || !count ? 0.5 : (endpoint.pole + 0.5) / count) * position.w,
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
    const points = wire.points ?? automaticWireRoute(
      routingTerminal(wire.from, last), routingTerminal(wire.to, first), obstacles, wire.id
    ).slice(1, -1);
    const result = [
      first,
      ...points.map((point, i) =>
        drag?.kind === 'point' && drag.id === wire.id && drag.index === i ? drag.point : point
      ),
      last
    ];
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
  const startDrag = (event: PointerEvent, kind: Drag['kind'], id: string, point: Point, index?: number) => {
    if (event.button !== 0 || deviceDragRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    svgRef.current?.setPointerCapture(event.pointerId);
    const cursor = svgPoint(event.clientX, event.clientY);
    setDrag({ kind, id, index, point, delta: { x: point.x - cursor.x, y: point.y - cursor.y } });
  };
  const commitDrag = () => {
    if (!drag) return;
    const value = drag;
    setDrag(undefined);
    if (value.kind === 'bus') patchBus(value.id, { offset: value.point });
    else if (value.kind === 'infeed') patchInfeed(value.id, { position: value.point });
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
      } else {
        const points = route(wire, index).slice(1, -1);
        points[value.index ?? 0] = value.point;
        patchWire(value.id, { points });
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
  const viewport = deviceDrag?.viewport ?? { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const { width, height } = viewport;
  return {
    svgRef,
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
    endpointPoint,
    route,
    wireLabelPoint,
    svgPoint,
    startDrag,
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
  onSelectEndpoint
}: Props) {
  const pePatternId = `wiring-pe-${useId().replace(/:/g, '')}`;
  const deviceClipId = `wiring-device-${useId().replace(/:/g, '')}`;
  const {
    svgRef,
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
    endpointPoint,
    route,
    wireLabelPoint,
    svgPoint,
    startDrag,
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
          if (!moveDeviceDrag(event) && drag) {
            const point = svgPoint(event.clientX, event.clientY);
            setDrag({ ...drag, point: { x: point.x + drag.delta.x, y: point.y + drag.delta.y } });
          }
        }}
        onPointerUp={(event) => {
          const completed = commitDeviceDrag(event.pointerId);
          if (completed.clicked) onSelectDevice(completed.clicked);
          if (!completed.handled) commitDrag();
        }}
        onPointerCancel={(event) => {
          cancelDeviceDrag(event.pointerId);
          if (!deviceDrag) setDrag(undefined);
        }}
        onLostPointerCapture={(event) => cancelDeviceDrag(event.pointerId)}
      >
        <defs>
          <pattern id={pePatternId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width={8} height={8} fill={GREEN_YELLOW.green} />
            <rect width={4} height={8} fill={GREEN_YELLOW.yellow} />
          </pattern>
        </defs>
        <rect className="wiring-cabinet-frame" {...frame} rx={12} />
        <rect className="wiring-cabinet-inset" x={frame.x + 14} y={frame.y + 14} width={frame.width - 28} height={frame.height - 28} rx={6} />
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
        {wiring.wires.map((wire, index) => {
          const points = route(wire, index).map((point) => `${point.x},${point.y}`).join(' ');
          const appearance = wireColorAppearance(wire, endpointConductor(data, wire.from) ?? 'L');
          const path = roundedWirePath(route(wire, index));
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
                  effectiveDevicePoles(device).map((pole, index) =>
                    terminal(
                      { kind: 'device', deviceId: id, side, pole: index },
                      endpointPoint({ kind: 'device', deviceId: id, side, pole: index }),
                      pole
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
                width={Math.max(90, source.poles.length * 26 + 10)}
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
        {selectedWire &&
          selectedRoute
            .slice(1, -1)
            .map((point, index) => (
              <circle
                className="wiring-route-handle"
                data-testid={`wire-bend-${index}`}
                key={index}
                cx={point.x}
                cy={point.y}
                r={7}
                onPointerDown={(event) => startDrag(event, 'point', selectedWire.id, point, index)}
              />
            ))}
      </svg>
    </div>
  );
}
