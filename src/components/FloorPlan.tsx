import { t, getLocale } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent } from 'react';
import {
  Crosshair,
  FileImage,
  Layers2,
  Maximize,
  Minus,
  MousePointer2,
  Plus,
  RotateCw,
  Route as RouteIcon,
  Ruler,
  Trash2
} from 'lucide-react';
import type { Asset, DeviceKind, PlanSheet, Point, ProjectData, Route } from '../types';
import { kindLabel, uid } from '../catalog';
import { moveSheetBoard, moveSheetDevice } from '../data/floorPlan';
import { floorRoutePoints } from '../data/floorRoute';
import { floorRouteCircuitId } from '../data/floorRouteCircuit';
import { isEmptyPlanSheet } from '../data/planBackground';
import { getFloorPlanDisplay, getPlanAppearance, getPlanSheetBounds } from '../data/planAppearance';
import { PlanDeviceGraphic } from './PlanDeviceGraphic';
import { BoardMarkerGraphic } from './BoardMarkerGraphic';
import './floor-board.css';
import { insertWireBend, moveWireBend, moveWireSegment, orthogonalRoute, removeWireBend } from './board-wiring/wireEditing';
import './floor-route-edit.css';
import './floor-context-actions.css';

export interface FloorPlanProps {
  data: ProjectData;
  assets: Record<string, Asset>;
  sheetId: string;
  selectedId: string | null;
  tool: DeviceKind | 'select' | 'route' | 'control' | 'note' | 'text' | 'scale' | 'board';
  onSelect: (id: string | null) => void;
  onChange: (data: ProjectData) => void;
  onAddDevice: (kind: DeviceKind, sheetId: string, point: Point) => void;
  onOpenBoard: (id: string) => void;
  onBoardPlaced: () => void;
  onNotify: (message: string) => void;
  onUploadBackground?: () => void;
  onDropBackground?: (files: File[]) => void;
  deviceToolLabel?: string;
  tools?: ReactNode;
  selectionHost?: HTMLElement | null;
}

type FloorEndpoint = { kind: 'device' | 'board'; id: string };
type View = { x: number; y: number; width: number; height: number };
type Drag = {
  mode: 'pan' | 'device' | 'note' | 'bend' | 'segment' | 'board';
  id: string;
  pointerId: number;
  start: Point;
  origin: Point;
  view: View;
  a: number;
  d: number;
  moved: boolean;
  bendIndex?: number;
  routePoints?: Point[];
};
type Pinch = { distance: number; point: Point; view: View; matrix: DOMMatrix };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pointOnSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
};

export function FloorPlan({
  data,
  assets,
  sheetId,
  selectedId,
  tool,
  onSelect,
  onChange,
  onAddDevice,
  onOpenBoard,
  onBoardPlaced,
  onNotify,
  onUploadBackground,
  onDropBackground,
  deviceToolLabel,
  tools,
  selectionHost
}: FloorPlanProps) {
  const display = getFloorPlanDisplay(data);
  const persistedSheet = data.sheets.find((s) => s.id === sheetId);
  const [draftSheet, setDraftSheet] = useState<PlanSheet | null>(null);
  const draftRef = useRef<PlanSheet | null>(null);
  const sheet = draftSheet?.id === sheetId ? draftSheet : persistedSheet;
  const fit = (): View => sheet ? getPlanSheetBounds(sheet, data.devices, assets, display, data.boards)
    : { x: -48, y: -48, width: 1296, height: 896 };
  const [view, setView] = useState<View>(fit);
  const [layersOpen, setLayersOpen] = useState(false);
  const [layers, setLayers] = useState({ background: true, devices: true, routes: true, notes: true, grid: false });
  const [fromEndpoint, setFromEndpoint] = useState<FloorEndpoint | null>(null);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedBend, setSelectedBend] = useState<{ routeId: string; index: number; point: Point } | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [boardToPlace, setBoardToPlace] = useState(data.boards[0]?.id ?? '');
  const [scaleStart, setScaleStart] = useState<Point | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileOver, setFileOver] = useState(false);
  const fileDragDepth = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<Pinch | null>(null);
  const dataRef = useRef(data);
  const suppressClick = useRef(false);
  const boardClick = useRef<{ id:string; time:number; x:number; y:number } | null>(null);
  const boardSelectTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const cancelTimer = () => {
      if (boardSelectTimer.current !== undefined) window.clearTimeout(boardSelectTimer.current);
      boardSelectTimer.current = undefined;
    };
    const pointerDown = (event: PointerEvent) => {
      if (!boardClick.current) return;
      cancelTimer();
      const marker = event.target instanceof Element ? event.target.closest('.floor-board-marker') : null;
      if (marker?.getAttribute('data-board-id') !== boardClick.current.id) boardClick.current = null;
    };
    const keyDown = () => { cancelTimer(); boardClick.current = null; };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('keydown', keyDown, true);
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('keydown', keyDown, true);
      cancelTimer(); boardClick.current = null;
    };
  }, [sheetId, tool]);
  const devices = useMemo(() => new Map(data.devices.map((device) => [device.id, device])), [data.devices]);
  const circuits = useMemo(() => new Map(data.circuits.map((circuit) => [circuit.id, circuit])), [data.circuits]);
  dataRef.current = data;

  useEffect(() => {
    setView(fit());
    setFromEndpoint(null);
    setScaleStart(null);
    setSelectedRouteId(null);
    setSelectedNoteId(null);
    setSelectedBoardId(null);
    setDraftSheet(null);
    draftRef.current = null;
  }, [sheetId, persistedSheet?.backgroundAssetId]); // Fit a newly imported background once.
  useEffect(() => {
    setFromEndpoint(null);
    setScaleStart(null);
  }, [tool]);
  useEffect(() => {
    if (!data.boards.some(board => board.id === boardToPlace)) setBoardToPlace(data.boards[0]?.id ?? '');
  }, [data.boards, boardToPlace]);
  useEffect(() => {
    if (selectedId || selectedRouteId || selectedNoteId) setSelectedBoardId(null);
  }, [selectedId, selectedRouteId, selectedNoteId]);
  useEffect(() => { setSelectedBend(null); }, [selectedRouteId, sheetId]);
  useEffect(() => {
    if (!selectedId) return;
    setSelectedRouteId(null);
    setSelectedNoteId(null);
    const placement = data.sheets.find((s) => s.id === sheetId)?.placements.find((p) => p.deviceId === selectedId);
    const element = svg.current;
    const matrix = element?.getScreenCTM();
    if (!placement || !element || !matrix) return;
    const screen = new DOMPoint(placement.x, placement.y).matrixTransform(matrix);
    const bounds = element.getBoundingClientRect();
    const margin = 24;
    if (
      screen.x < bounds.left + margin ||
      screen.x > bounds.right - margin ||
      screen.y < bounds.top + margin ||
      screen.y > bounds.bottom - margin
    ) {
      setView((current) => ({ ...current, x: placement.x - current.width / 2, y: placement.y - current.height / 2 }));
    }
  }, [selectedId, sheetId]);

  if (!sheet) return <div className="floor-no-sheet">{t('Hozz létre egy tervlapot az alaprajz szerkesztéséhez.')}</div>;
  const background = sheet.backgroundAssetId ? assets[sheet.backgroundAssetId] : undefined;
  const selectedPlacement = sheet.placements.find((p) => p.deviceId === selectedId);
  const selectedDevice = selectedId ? devices.get(selectedId) : undefined;
  const selectedCircuit = selectedDevice?.circuitId ? circuits.get(selectedDevice.circuitId) : undefined;
  const selectedRoute = sheet.routes.find((r) => r.id === selectedRouteId);
  const selectedRoutePoints = selectedRoute ? floorRoutePoints(selectedRoute, sheet) : [];
  const selectedBendIndex = (() => {
    if (!selectedBend || selectedBend.routeId !== selectedRouteId) return -1;
    const matches = (point:Point | undefined) => point?.x === selectedBend.point.x && point?.y === selectedBend.point.y;
    if (selectedBend.index > 0 && selectedBend.index < selectedRoutePoints.length - 1 && matches(selectedRoutePoints[selectedBend.index])) return selectedBend.index;
    return selectedRoutePoints.findIndex((point, index) => index > 0 && index < selectedRoutePoints.length - 1 && matches(point));
  })();
  const selectedText = sheet.annotations.find((note) => note.id === selectedNoteId && note.kind === 'text');
  const selectedBoard = data.boards.find((board) => board.id === selectedBoardId);
  const selectedBoardPlacement = sheet.boardPlacements?.find((placement) => placement.boardId === selectedBoardId);
  const endpointPoint = (endpoint: FloorEndpoint) => endpoint.kind === 'device'
    ? sheet.placements.find((placement) => placement.deviceId === endpoint.id)
    : sheet.boardPlacements?.find((placement) => placement.boardId === endpoint.id);
  const fromPlacement = fromEndpoint ? endpointPoint(fromEndpoint) : undefined;
  const fittedWidth = fit().width;
  const zoomPercent = Math.round((fittedWidth / view.width) * 100);

  const updateSheet = (update: (s: PlanSheet) => PlanSheet) => {
    if (drag.current?.moved && drag.current.mode !== 'pan') {
      const current = draftRef.current ?? dataRef.current.sheets.find((s) => s.id === sheetId);
      if (current) {
        const next = update(current);
        draftRef.current = next;
        setDraftSheet(next);
      }
      return;
    }
    onChange({ ...dataRef.current, sheets: dataRef.current.sheets.map((s) => (s.id === sheetId ? update(s) : s)) });
  };
  const worldPoint = (clientX: number, clientY: number) => {
    const m = svg.current?.getScreenCTM()?.inverse();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  const snapped = (p: Point): Point => ({
    x: Math.max(0, Math.min(sheet.width, layers.grid ? Math.round(p.x / 10) * 10 : p.x)),
    y: Math.max(0, Math.min(sheet.height, layers.grid ? Math.round(p.y / 10) * 10 : p.y))
  });
  const moveDevice = (id: string, point: Point) => updateSheet((s) => moveSheetDevice(s, id, snapped(point)));
  const removeSelectedBend = () => {
    if (!selectedRoute || selectedBendIndex < 1) return false;
    const current = orthogonalRoute(selectedRoutePoints);
    const target = selectedBend!.point;
    const index = current.findIndex((point, i) => i > 0 && i < current.length - 1 && point.x === target.x && point.y === target.y);
    if (index < 1) { setSelectedBend(null); return true; }
    const interior = removeWireBend(current, index - 1, layers.grid);
    if (JSON.stringify(interior) === JSON.stringify(current.slice(1, -1))) {
      onNotify(t('A töréspont nem törölhető: a két végpont között legalább egy sarok szükséges.'));
      return true;
    }
    const points = [current[0], ...interior, current[current.length - 1]];
    updateSheet((s) => ({ ...s, routes: s.routes.map((r) => r.id === selectedRoute.id ? { ...r, points } : r) }));
    setSelectedBend(null);
    return true;
  };
  const removeSelected = () => {
    if (selectedBoardId && selectedBoardPlacement) {
      if (sheet.routes.some((route) => route.fromBoardId === selectedBoardId || route.toBoardId === selectedBoardId) &&
        !window.confirm(t('Az elosztó eltávolításával a hozzá kapcsolódó nyomvonalak is törlődnek erről a tervlapról. Folytatod?'))) return;
      updateSheet((s) => ({ ...s,
        boardPlacements: s.boardPlacements?.filter((placement) => placement.boardId !== selectedBoardId),
        routes: s.routes.filter((route) => route.fromBoardId !== selectedBoardId && route.toBoardId !== selectedBoardId)
      }));
      setSelectedBoardId(null);
      onNotify(t('Az elosztó lekerült a tervlapról. Az elosztóterv megmaradt.'));
    } else if (selectedRouteId) {
      updateSheet((s) => ({ ...s, routes: s.routes.filter((r) => r.id !== selectedRouteId) }));
      setSelectedRouteId(null);
    } else if (selectedNoteId) {
      updateSheet((s) => ({ ...s, annotations: s.annotations.filter((n) => n.id !== selectedNoteId) }));
      setSelectedNoteId(null);
    } else if (selectedPlacement) {
      updateSheet((s) => ({
        ...s,
        placements: s.placements.filter((p) => p.deviceId !== selectedId),
        routes: s.routes.filter((r) => r.fromDeviceId !== selectedId && r.toDeviceId !== selectedId)
      }));
      onSelect(null);
      onNotify(t('Az eszköz lekerült a tervlapról. Az eszközlistában megmaradt.'));
    }
  };
  const zoom = (factor: number, point?: Point) => {
    const p = point ?? { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    setView((v) => {
      const f = Math.max(fittedWidth / 16, Math.min(fittedWidth * 5, v.width * factor)) / v.width;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, width: v.width * f, height: v.height * f };
    });
  };
  const registerPointer = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const matrix = svg.current?.getScreenCTM()?.inverse();
      if (matrix) {
        const mid = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(matrix);
        pinch.current = { distance: distance(a, b), point: mid, view, matrix };
        drag.current = null;
        suppressClick.current = true;
      }
    }
  };
  const startDrag = (e: ReactPointerEvent, mode: Drag['mode'], id: string, origin: Point, bendIndex?: number, routePoints?: Point[]) => {
    if (pinch.current || e.button > 0) return;
    const m = svg.current?.getScreenCTM()?.inverse();
    if (!m) return;
    drag.current = {
      mode,
      id,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin,
      view,
      a: m.a,
      d: m.d,
      moved: false,
      bendIndex,
      routePoints: routePoints?.map(point => ({ ...point }))
    };
    svg.current?.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (tool === 'route' || tool === 'control' || tool === 'scale') setCursor(worldPoint(e.clientX, e.clientY));
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const initial = pinch.current;
      const f = Math.max(0.08, Math.min(8, initial.distance / distance(a, b)));
      const middle = new DOMPoint((a.x + b.x) / 2, (a.y + b.y) / 2).matrixTransform(initial.matrix);
      setView({
        x: initial.point.x - (middle.x - initial.view.x) * f,
        y: initial.point.y - (middle.y - initial.view.y) * f,
        width: initial.view.width * f,
        height: initial.view.height * f
      });
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = (e.clientX - d.start.x) * d.a;
    const dy = (e.clientY - d.start.y) * d.d;
    if (Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y) < 3 && !d.moved) return;
    d.moved = true;
    suppressClick.current = true;
    setDragging(true);
    const next = { x: d.origin.x + dx, y: d.origin.y + dy };
    if (d.mode === 'pan') setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy });
    if (d.mode === 'device') moveDevice(d.id, next);
    if (d.mode === 'board') updateSheet((s) => moveSheetBoard(s, d.id, snapped(next)));
    if (d.mode === 'note')
      updateSheet((s) => ({
        ...s,
        annotations: s.annotations.map((n) => (n.id === d.id ? { ...n, ...snapped(next) } : n))
      }));
    if ((d.mode === 'bend' || d.mode === 'segment') && d.routePoints && d.bendIndex !== undefined) {
      const result = d.mode === 'bend'
        ? moveWireBend(d.routePoints, d.bendIndex, snapped(next), layers.grid)
        : moveWireSegment(d.routePoints, d.bendIndex, snapped(next), layers.grid);
      updateSheet((s) => ({ ...s, routes: s.routes.map((r) => r.id === d.id ? { ...r, points: result.route } : r) }));
      if (d.mode === 'bend') setSelectedBend({ routeId:d.id, index:result.index, point:result.route[result.index] });
    }
  };
  const onUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    // The SVG owns pointer capture; the resulting canvas click must not clear
    // the element selected after this pointer interaction ends.
    const boardDrag = e.type !== 'pointercancel' && drag.current?.pointerId === e.pointerId &&
      drag.current.mode === 'board' ? { id:drag.current.id, moved:drag.current.moved } : null;
    if (e.type === 'pointercancel' && drag.current?.mode === 'board') boardClick.current = null;
    if (drag.current?.mode && drag.current.mode !== 'pan') suppressClick.current = true;
    drag.current = null;
    setDragging(false);
    if (draftRef.current) {
      const committed = draftRef.current;
      draftRef.current = null;
      setDraftSheet(null);
      onChange({ ...dataRef.current, sheets: dataRef.current.sheets.map((s) => (s.id === sheetId ? committed : s)) });
    }
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if (boardDrag) {
      const selectBoard = () => {
        setSelectedBoardId(boardDrag.id); setSelectedRouteId(null); setSelectedNoteId(null); onSelect(null);
      };
      if (boardSelectTimer.current !== undefined) window.clearTimeout(boardSelectTimer.current);
      boardSelectTimer.current = undefined;
      if (!boardDrag.moved && e.pointerType === 'mouse') {
        const previous = boardClick.current;
        const now = Date.now();
        if (previous?.id === boardDrag.id && now - previous.time < 450 && Math.hypot(e.clientX-previous.x, e.clientY-previous.y) < 10) {
          boardClick.current = null;
          onOpenBoard(boardDrag.id);
        } else {
          boardClick.current = { id:boardDrag.id, time:now, x:e.clientX, y:e.clientY };
          boardSelectTimer.current = window.setTimeout(() => { boardClick.current = null; boardSelectTimer.current = undefined; selectBoard(); }, 450);
        }
      } else { boardClick.current = null; selectBoard(); }
    }
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };
  const chooseEndpoint = (endpoint: FloorEndpoint) => {
    if (suppressClick.current) return;
    if (!fromEndpoint) {
      setFromEndpoint(endpoint);
      setSelectedBoardId(null);
      setSelectedRouteId(null);
      setSelectedNoteId(null);
      onSelect(null);
      return;
    }
    const same = (a: FloorEndpoint, b: FloorEndpoint) => a.kind === b.kind && a.id === b.id;
    if (same(fromEndpoint, endpoint)) {
      setFromEndpoint(null);
      return;
    }
    const a = endpointPoint(fromEndpoint);
    const b = endpointPoint(endpoint);
    if (!a || !b) { setFromEndpoint(null); return; }
    const kind = tool === 'route' ? 'power' : 'control';
    const matches = (route: Route, side: 'from' | 'to', value: FloorEndpoint) =>
      value.kind === 'board'
        ? (side === 'from' ? route.fromBoardId : route.toBoardId) === value.id
        : (side === 'from' ? route.fromDeviceId : route.toDeviceId) === value.id;
    if (sheet.routes.some((route) => route.kind === kind &&
      ((matches(route, 'from', fromEndpoint) && matches(route, 'to', endpoint)) ||
       (matches(route, 'to', fromEndpoint) && matches(route, 'from', endpoint))))) {
      onNotify(t('Ez a kapcsolat már szerepel a tervlapon.'));
      setFromEndpoint(null);
      return;
    }
    const middle = (a.x + b.x) / 2;
    const route: Route = {
      id: uid(),
      ...(fromEndpoint.kind === 'device' ? { fromDeviceId: fromEndpoint.id } : { fromBoardId: fromEndpoint.id }),
      ...(endpoint.kind === 'device' ? { toDeviceId: endpoint.id } : { toBoardId: endpoint.id }),
      kind,
      circuitId: (fromEndpoint.kind === 'device' ? devices.get(fromEndpoint.id)?.circuitId : undefined) ??
        (endpoint.kind === 'device' ? devices.get(endpoint.id)?.circuitId : undefined),
      points: [
        { x: a.x, y: a.y },
        { x: middle, y: a.y },
        { x: middle, y: b.y },
        { x: b.x, y: b.y }
      ]
    };
    updateSheet((s) => ({ ...s, routes: [...s.routes, route] }));
    setFromEndpoint(null);
    setSelectedBoardId(null);
    onSelect(null);
    setSelectedRouteId(route.id);
    onNotify(t('Kapcsolat létrehozva. A töréspontokat húzással szerkesztheted.'));
  };
  const deviceClick = (id: string) => {
    if (suppressClick.current) return;
    if (tool === 'route' || tool === 'control') {
      chooseEndpoint({ kind: 'device', id });
      return;
    }
    onSelect(id);
    setSelectedRouteId(null);
    setSelectedNoteId(null);
  };
  const canvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) return;
    const p = snapped(worldPoint(e.clientX, e.clientY));
    if (tool === 'select') {
      if (sheet && isEmptyPlanSheet(sheet)) onUploadBackground?.();
      onSelect(null);
      setSelectedRouteId(null);
      setSelectedNoteId(null);
      setSelectedBoardId(null);
      return;
    }
    if (tool === 'board') {
      if (!data.boards.some((board) => board.id === boardToPlace)) return;
      if (sheet.boardPlacements?.some((placement) => placement.boardId === boardToPlace)) {
        onNotify(t('Ez az elosztó már szerepel ezen a tervlapon.'));
        return;
      }
      updateSheet((s) => ({ ...s, boardPlacements: [...(s.boardPlacements ?? []), { boardId: boardToPlace, ...p }] }));
      setSelectedBoardId(boardToPlace);
      setSelectedRouteId(null);
      setSelectedNoteId(null);
      onSelect(null);
      onBoardPlaced();
      onNotify(t('Elosztó elhelyezve. A kijelölt elosztó terve gombbal vagy dupla kattintással nyitható meg.'));
      return;
    }
    if (tool === 'route' || tool === 'control') {
      setFromEndpoint(null);
      return;
    }
    if (tool === 'note' || tool === 'text') {
      const text = window.prompt(t(tool === 'text' ? 'Szöveg a tervlapon:' : 'Megjegyzés a tervlapon:'));
      if (text?.trim()) {
        const id = uid();
        updateSheet((s) => ({ ...s, annotations: [...s.annotations, { id, ...p, text: text.trim(), ...(tool === 'text' ? { kind: 'text' as const, fontSize: 18, color: '#222222' } : {}) }] }));
        if (tool === 'text') { setSelectedNoteId(id); setSelectedRouteId(null); onSelect(null); }
      }
      return;
    }
    if (tool === 'scale') {
      if (!scaleStart) {
        setScaleStart(p);
        return;
      }
      const measured = distance(scaleStart, p);
      if (measured < 1) {
        onNotify(t('A második pontot távolabb jelöld ki.'));
        return;
      }
      const answer = window.prompt(t('A kijelölt szakasz valós hossza méterben:'), '1');
      if (answer !== null) {
        const meters = Number(answer.replace(',', '.'));
        if (Number.isFinite(meters) && meters > 0) {
          updateSheet((s) => ({ ...s, mmPerUnit: (meters * 1000) / measured }));
          onNotify(t('A tervlap méretaránya beállítva.'));
        } else onNotify(t('Pozitív hosszúságot adj meg méterben.'));
      }
      setScaleStart(null);
      return;
    }
    onAddDevice(tool, sheetId, p);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,textarea,select,button')) return;
    if (e.key === 'Escape') {
      onSelect(null);
      setSelectedRouteId(null);
      setSelectedNoteId(null);
      setSelectedBoardId(null);
      setFromEndpoint(null);
      setScaleStart(null);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (removeSelectedBend()) return;
      removeSelected();
    }
    if (selectedPlacement && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const n = e.shiftKey ? 20 : 5;
      moveDevice(selectedPlacement.deviceId, {
        x: selectedPlacement.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0),
        y: selectedPlacement.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0)
      });
    }
    if (selectedBoardPlacement && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const n = e.shiftKey ? 20 : 5;
      const position = snapped({
        x: selectedBoardPlacement.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0),
        y: selectedBoardPlacement.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0)
      });
      updateSheet((s) => moveSheetBoard(s, selectedBoardPlacement.boardId, position));
    }
  };
  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    zoom(Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015))), worldPoint(e.clientX, e.clientY));
  };
  const colorFor = (deviceId: string | undefined, circuitId?: string) =>
    circuits.get((deviceId ? devices.get(deviceId)?.circuitId : undefined) ?? circuitId ?? '')?.color ?? '#28775b';
  const routeLength = (route: Route) => {
    const points = floorRoutePoints(route, sheet);
    return (points.slice(1).reduce((total, p, i) => total + distance(points[i], p), 0) * (sheet.mmPerUnit ?? 0)) / 1000;
  };
  const instruction =
    tool === 'board'
      ? t('Válaszd ki az elosztót, majd kattints a helyére')
      : tool === 'route' || tool === 'control'
      ? fromEndpoint
        ? t('Válaszd ki a kapcsolat másik eszközét vagy elosztóját')
        : t('Válaszd ki a kapcsolat első eszközét vagy elosztóját')
      : tool === 'scale'
        ? scaleStart
          ? t('Jelöld ki a mérési szakasz másik végét')
          : t('Jelöld ki egy ismert hosszúságú szakasz két végét')
        : tool === 'note'
          ? t('Kattints a megjegyzés helyére')
          : tool === 'text'
            ? t('Kattints a szöveg helyére')
          : tool !== 'select'
            ? t('{device} · kattints az elhelyezéshez', { device: deviceToolLabel || kindLabel(tool) })
            : '';

  const selectionTools = (selectedRoute || selectedNoteId || selectedPlacement || (selectedBoard && selectedBoardPlacement)) ? (
          <div className="floor-selection-tools">
            {selectedBoard && selectedBoardPlacement && <><span>{t('Elosztó')}: {selectedBoard.name}</span>
              <button className="floor-board-open" onClick={() => onOpenBoard(selectedBoard.id)}>{t('Elosztóterv megnyitása')}</button>
            </>}
            {selectedDevice && selectedPlacement && (
              <>
                <span>
                  <span className="floor-selected-code">{selectedDevice.code}</span>
                  {kindLabel(selectedDevice.kind)}
                </span>
                <button
                  title={t('Forgatás 90°')}
                  aria-label={t('Forgatás 90 fokkal')}
                  onClick={() =>
                    updateSheet((s) => ({
                      ...s,
                      placements: s.placements.map((p) =>
                        p.deviceId === selectedId ? { ...p, rotation: (p.rotation + 90) % 360 } : p
                      )
                    }))
                  }
                >
                  <RotateCw size={15} />
                </button>
              </>
            )}
            {selectedRoute && (
              <>
                <span>
                  <RouteIcon size={15} />
                  {selectedRoute.kind === 'control' ? t('Vezérlési kapcsolat') : t('Villamos kapcsolat')}
                  {sheet.mmPerUnit
                    ? ` · ${routeLength(selectedRoute).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} m`
                    : ''}
                </span>
                <small>{t('Pont vagy szakasz: húzás · kijelölt pont: Delete')}</small>
                <button
                  title={t('Töréspont hozzáadása')}
                  aria-label={t('Töréspont hozzáadása')}
                  onClick={() => {
                    const points = orthogonalRoute(selectedRoutePoints);
                    if (points.length < 2) return;
                    const interior = insertWireBend(points, layers.grid);
                    updateSheet((s) => ({ ...s, routes:s.routes.map((r) => r.id === selectedRoute.id
                      ? { ...r, points:[points[0], ...interior, points[points.length - 1]] } : r) }));
                    setSelectedBend(null);
                  }}
                ><Plus size={16}/></button>
                {selectedBendIndex > 0 && <button
                  title={t('Kijelölt töréspont törlése')}
                  aria-label={t('Kijelölt töréspont törlése')}
                  onClick={removeSelectedBend}
                ><Trash2 size={15}/></button>}
              </>
            )}
            {selectedNoteId && !selectedText && tool === 'note' && <span>{t('Megjegyzés · dupla kattintás: szerkesztés')}</span>}
            <button
              className="floor-delete-control"
              title={t('Eltávolítás a tervlapról')}
              aria-label={t('Kijelölt elem eltávolítása')}
              onClick={removeSelected}
            >
              <Trash2 size={15} />
            </button>
          </div>
  ) : null;

  return (
    <div
      className={`floor-workspace ${tool !== 'select' ? 'floor-tool-active' : ''} ${dragging ? 'floor-is-dragging' : ''} ${fileOver ? 'floor-file-over' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        fileDragDepth.current++;
        setFileOver(true);
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => {
        fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
        if (!fileDragDepth.current) setFileOver(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        fileDragDepth.current = 0;
        setFileOver(false);
        onDropBackground?.(Array.from(e.dataTransfer.files));
      }}
      onKeyDown={onKey}
      tabIndex={0}
      aria-label={t('Alaprajz szerkesztő. A kijelölt eszközt a nyilakkal mozgathatod.')}
    >
      {isEmptyPlanSheet(sheet) && tool === 'select' && onUploadBackground && <button
        type="button" className="floor-upload-empty" onClick={onUploadBackground}
      >
        <FileImage size={38} strokeWidth={1.2} />
        <strong>{t('Alaprajz feltöltése')}</strong>
        <span>{t('Kattints ide, vagy húzz ide egy fájlt.')}</span>
        <small>PDF · PNG · JPG</small>
      </button>}
      {fileOver && <div className="floor-drop-hint" role="status">{t('Engedd el az alaprajz feltöltéséhez')}</div>}
      <div className="floor-control-header">
        {tools}
        {tool === 'board' && <label className="floor-board-picker">
          <span>{t('Elhelyezendő elosztó')}</span>
          <select aria-label={t('Elhelyezendő elosztó')} value={boardToPlace} onChange={(e) => setBoardToPlace(e.target.value)}>
            {data.boards.map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
          </select>
        </label>}
        <div className="floor-display-switch" role="group" aria-label={t('Alaprajzi megjelenítés')}>
          {(['symbols', 'images'] as const).map((mode) => <button
            type="button" key={mode} aria-pressed={display === mode}
            onClick={() => {
              if (mode !== display) onChange({ ...dataRef.current, floorPlanDisplay: mode });
            }}
          >{t(mode === 'symbols' ? 'Rajzjelek' : 'Valós képek')}</button>)}
        </div>
        <div className="floor-sheet-caption visually-hidden">
          <span className="floor-sheet-dot" />
          {sheet.name}
          <span className="floor-caption-separator">/</span>
          <span>{t('{count} eszköz', { count: sheet.placements.length })}</span>
        </div>
        <div className="floor-layer-tools">
          <button
            className={`floor-control ${layersOpen ? 'is-on' : ''}`}
            onClick={() => setLayersOpen(!layersOpen)}
            title={t('Rétegek')}
            aria-label={t('Rétegek')}
            aria-expanded={layersOpen}
          >
            <Layers2 size={18} />
          </button>
          {layersOpen && (
            <div className="floor-layers-popover">
              <strong>{t('Megjelenítés')}</strong>
              {(
                [
                  ['background', t('Alaprajz')],
                  ['devices', t('Eszközök és jelölések')],
                  ['routes', t('Kapcsolatok')],
                  ['notes', t('Megjegyzések')],
                  ['grid', t('Rács és illesztés')]
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(e) => setLayers({ ...layers, [key]: e.target.checked })}
                  />
                  <span>{label}</span>
                </label>
              ))}
              {background && <label className="floor-opacity-control">
                <span>{t('Alaprajz fedettsége')}: {Math.round((sheet.backgroundOpacity ?? 1) * 100)}%</span>
                <input type="range" min="0" max="100" step="1" value={Math.round((sheet.backgroundOpacity ?? 1) * 100)}
                  aria-label={t('Alaprajz fedettsége')}
                  onChange={(e) => updateSheet((s) => ({ ...s, backgroundOpacity: Number(e.target.value) / 100 }))} />
              </label>}
            </div>
          )}
        </div>
      </div>
      {instruction && (
        <div className="floor-instruction" role="status">
          <Crosshair size={15} />
          <span>{instruction}</span>
          {(fromEndpoint || scaleStart) && (
            <button
              onClick={() => {
                setFromEndpoint(null);
                setScaleStart(null);
              }}
            >
              {t('Mégse')}
            </button>
          )}
        </div>
      )}
      <svg
        ref={svg}
        className="floor-svg"
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        role="img"
        aria-label={t('{name} villamos alaprajza', { name: sheet.name })}
        onPointerDownCapture={registerPointer}
        onPointerDown={(e) => {
          if (tool === 'select') startDrag(e, 'pan', '', { x: 0, y: 0 });
        }}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={(e) => {
          if (!drag.current && !pinch.current) pointers.current.delete(e.pointerId);
        }}
        onClick={canvasClick}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="floor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r=".9" fill="#b8c4be" />
          </pattern>
          <filter id="floor-paper-shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="10" floodColor="#203e30" floodOpacity=".07" />
          </filter>
        </defs>
        <rect
          className="floor-paper"
          width={sheet.width}
          height={sheet.height}
          fill="white"
          filter="url(#floor-paper-shadow)"
        />
        {background && layers.background && (
          <image
            href={background.data}
            x="0"
            y="0"
            width={sheet.width}
            height={sheet.height}
            preserveAspectRatio="none"
            opacity={sheet.backgroundOpacity ?? 1}
            pointerEvents="none"
          />
        )}
        {layers.grid && <rect width={sheet.width} height={sheet.height} fill="url(#floor-grid)" pointerEvents="none" />}
        {!background && !sheet.placements.length && !onUploadBackground && (
          <g pointerEvents="none" className="floor-empty-canvas">
            <rect
              x={sheet.width / 2 - 26}
              y={sheet.height / 2 - 67}
              width="52"
              height="42"
              rx="5"
              fill="none"
              stroke="#b6c6bc"
              strokeWidth="1.5"
            />
            <path
              d={`M${sheet.width / 2 - 15} ${sheet.height / 2 - 50}h30m-30 10h19`}
              stroke="#b6c6bc"
              strokeWidth="1.5"
            />
            <text
              x={sheet.width / 2}
              y={sheet.height / 2 + 4}
              textAnchor="middle"
              fill="#688273"
              fontSize="18"
              fontWeight="500"
            >
              {t('Itt kezdődik a terved')}
            </text>
            <text x={sheet.width / 2} y={sheet.height / 2 + 31} textAnchor="middle" fill="#91a296" fontSize="12">
              {t('Tölts fel egy alaprajzot, vagy helyezz el eszközöket.')}
            </text>
          </g>
        )}
        {layers.routes &&
          // Render the selected route last within the route layer. Its hit areas
          // and editing handles then take precedence over neighbouring routes,
          // while devices, boards and annotations remain above the entire layer.
          [...sheet.routes.filter(route => route.id !== selectedRouteId), ...sheet.routes.filter(route => route.id === selectedRouteId)].map((route) => {
            const selected = route.id === selectedRouteId;
            const routeCircuitId = floorRouteCircuitId(route, devices);
            const color = circuits.get(routeCircuitId ?? '')?.color ?? '#28775b';
            const circuitHighlighted = !!selectedCircuit && routeCircuitId === selectedCircuit.id;
            const routePoints = floorRoutePoints(route, sheet);
            const editablePoints = orthogonalRoute(routePoints);
            return (
              <g
                key={route.id}
                data-route-id={route.id}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!suppressClick.current) {
                    setSelectedRouteId(route.id);
                    setSelectedNoteId(null);
                    onSelect(null);
                  }
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const p = snapped(worldPoint(e.clientX, e.clientY));
                  let index = 1;
                  let best = Infinity;
                  editablePoints.slice(1).forEach((v, i) => {
                    const length = pointOnSegment(p, editablePoints[i], v);
                    if (length < best) {
                      best = length;
                      index = i + 1;
                    }
                  });
                  if (editablePoints.length < 2) return;
                  const a = editablePoints[index - 1], b = editablePoints[index];
                  const point = a.x === b.x
                    ? { x:a.x, y:Math.max(Math.min(a.y,b.y), Math.min(Math.max(a.y,b.y), p.y)) }
                    : { x:Math.max(Math.min(a.x,b.x), Math.min(Math.max(a.x,b.x), p.x)), y:a.y };
                  updateSheet((s) => ({
                    ...s,
                    routes: s.routes.map((r) =>
                      r.id === route.id
                        ? { ...r, points: [...editablePoints.slice(0, index), point, ...editablePoints.slice(index)] }
                        : r
                    )
                  }));
                  setSelectedRouteId(route.id);
                  setSelectedBend({ routeId:route.id, index, point });
                }}
                className={`floor-route${circuitHighlighted ? ' floor-route-circuit-highlighted' : ''}`}
              >
                <polyline
                  points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                />
                {circuitHighlighted && <>
                  <polyline points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="#23312b" strokeWidth="10" strokeLinejoin="round" pointerEvents="none" />
                  <polyline points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none" stroke="white" strokeWidth="7" strokeLinejoin="round" pointerEvents="none" />
                </>}
                <polyline
                  points={routePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke={color}
                  strokeWidth={circuitHighlighted ? 4 : selected ? 3 : 2}
                  opacity={selected || circuitHighlighted ? 1 : 0.75}
                  strokeDasharray={route.kind === 'control' ? '7 5' : undefined}
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
                {selected && routePoints.slice(0, -1).map((p, index) => {
                  const next = routePoints[index + 1];
                  if (p.x === next.x && p.y === next.y) return null;
                  return <line key={`segment-${index}`} x1={p.x} y1={p.y} x2={next.x} y2={next.y}
                    className={`floor-route-segment ${p.y === next.y ? 'horizontal' : 'vertical'}`}
                    data-testid={`floor-route-segment-${index}`} role="button" tabIndex={0}
                    aria-label={t('{number}. nyomvonalszakasz mozgatása', { number:index + 1 })}
                    onPointerDown={(e) => {
                      e.preventDefault(); e.stopPropagation(); e.currentTarget.focus(); setSelectedBend(null);
                      const at = worldPoint(e.clientX, e.clientY);
                      let nearest = 0, best = Infinity;
                      editablePoints.slice(1).forEach((value, i) => {
                        const distance = pointOnSegment(at, editablePoints[i], value);
                        if (distance < best) { nearest = i; best = distance; }
                      });
                      startDrag(e, 'segment', route.id, at, nearest, editablePoints);
                    }}
                    onKeyDown={(e) => {
                      if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
                      e.preventDefault(); e.stopPropagation();
                      const at = { x:(p.x + next.x) / 2, y:(p.y + next.y) / 2 };
                      const indexInEdit = editablePoints.findIndex((point, i) => i < editablePoints.length - 1 && pointOnSegment(at, point, editablePoints[i + 1]) < 0.01);
                      if (indexInEdit < 0) return;
                      const n = e.shiftKey ? 20 : 5;
                      const result = moveWireSegment(editablePoints, indexInEdit, { x:at.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0), y:at.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0) }, layers.grid);
                      updateSheet((s) => ({ ...s, routes:s.routes.map((r) => r.id === route.id ? { ...r, points:result.route } : r) }));
                    }} />;
                })}
                {selected &&
                  routePoints.slice(1, -1).map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r="5"
                      fill={selectedBendIndex === i + 1 ? color : 'white'}
                      stroke={color}
                      strokeWidth="2"
                      className="floor-bend"
                      data-testid={`floor-route-bend-${i}`}
                      role="button"
                      tabIndex={0}
                      aria-label={t('{number}. nyomvonal töréspont', { number:i + 1 })}
                      onPointerDown={(e) => {
                        e.preventDefault(); e.stopPropagation(); e.currentTarget.focus();
                        setSelectedBend({ routeId:route.id, index:i + 1, point:p });
                        const index = editablePoints.findIndex((point, index) => index > 0 && index < editablePoints.length - 1 && point.x === p.x && point.y === p.y);
                        if (index > 0) startDrag(e, 'bend', route.id, p, index, editablePoints);
                      }}
                      onFocus={() => setSelectedBend({ routeId:route.id, index:i + 1, point:p })}
                      onKeyDown={(e) => {
                        if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
                        e.preventDefault(); e.stopPropagation();
                        const index = editablePoints.findIndex((point, index) => index > 0 && index < editablePoints.length - 1 && point.x === p.x && point.y === p.y);
                        if (index < 1) return;
                        const n = e.shiftKey ? 20 : 5;
                        const result = moveWireBend(editablePoints, index, { x:p.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0), y:p.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0) }, layers.grid);
                        updateSheet((s) => ({ ...s, routes:s.routes.map((r) => r.id === route.id ? { ...r, points:result.route } : r) }));
                        setSelectedBend({ routeId:route.id, index:result.index, point:result.route[result.index] });
                      }}
                    />
                  ))}
              </g>
            );
          })}
        {fromPlacement && cursor && (
          <path
            d={`M${fromPlacement.x} ${fromPlacement.y}H${cursor.x}V${cursor.y}`}
            fill="none"
            stroke="#20815d"
            strokeWidth="2"
            strokeDasharray="5 5"
            pointerEvents="none"
          />
        )}
        {scaleStart && (
          <g pointerEvents="none">
            <circle cx={scaleStart.x} cy={scaleStart.y} r="5" fill="#20815d" />
            {cursor && (
              <path
                d={`M${scaleStart.x} ${scaleStart.y}L${cursor.x} ${cursor.y}`}
                stroke="#20815d"
                strokeWidth="2"
                strokeDasharray="5 3"
              />
            )}
          </g>
        )}
        {layers.devices && sheet.boardPlacements?.map((placement) => {
          const board = data.boards.find((item) => item.id === placement.boardId);
          if (!board) return null;
          const boardLabel = tool === 'route' || tool === 'control'
            ? t('Elosztó kiválasztása kapcsolathoz: {name}', { name: board.name })
            : t('Elosztó kijelölése: {name}', { name: board.name });
          return <g key={`board-${board.id}`} data-board-id={board.id} transform={`translate(${placement.x} ${placement.y})`}
            className={`floor-board-marker ${selectedBoardId === board.id ? 'selected' : ''}`}
            role="button" tabIndex={0} aria-label={boardLabel}
            onFocus={() => {
              if (tool === 'select') { setSelectedBoardId(board.id); setSelectedRouteId(null); setSelectedNoteId(null); onSelect(null); }
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault(); e.stopPropagation();
              if (tool === 'route' || tool === 'control') chooseEndpoint({ kind: 'board', id: board.id });
              else if (tool === 'select') onOpenBoard(board.id);
            } }}
            onClick={(e) => {
              e.stopPropagation();
              if (tool === 'route' || tool === 'control') chooseEndpoint({ kind: 'board', id: board.id });
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (tool !== 'select') return;
              // Selection changes the footer height. Keep the SVG stable until a drag ends.
              e.preventDefault();
              startDrag(e, 'board', board.id, placement);
            }}>
            <title>{boardLabel}</title>
            <BoardMarkerGraphic board={board} display={display} selected={fromEndpoint?.kind === 'board' && fromEndpoint.id === board.id} />
          </g>;
        })}
        {layers.devices &&
          sheet.placements.map((placement) => {
            const device = devices.get(placement.deviceId);
            if (!device) return null;
            const selected = device.id === selectedId;
            const connected = fromEndpoint?.kind === 'device' && device.id === fromEndpoint.id;
            const circuitHighlighted = !!selectedCircuit && device.circuitId === selectedCircuit.id;
            const color = colorFor(device.id);
            const appearance = getPlanAppearance(device, assets, display);
            const radians = placement.rotation * Math.PI / 180;
            const halfExtent = appearance.kind === 'symbol' ? 19
              : appearance.size / 2 * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
            return (
              <g
                key={device.id}
                transform={`translate(${placement.x} ${placement.y})`}
                className={`floor-device ${selected ? 'floor-device-selected' : ''}${circuitHighlighted ? ' floor-device-circuit-highlighted' : ''}`}
                role="button"
                aria-label={`${device.code}, ${device.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  deviceClick(device.id);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (tool === 'select') {
                    onSelect(device.id);
                    setSelectedRouteId(null);
                    setSelectedNoteId(null);
                    startDrag(e, 'device', device.id, placement);
                  }
                }}
              >
                <title>
                  {device.code} · {device.name}
                  {device.room ? ` · ${device.room}` : ''}
                </title>
                <circle r={Math.max(12, halfExtent)} fill="transparent" pointerEvents="all" />
                {circuitHighlighted && <>
                  <circle r={halfExtent + 7} fill="none" stroke="#23312b" strokeWidth="10" pointerEvents="none" />
                  <circle r={halfExtent + 7} fill="none" stroke="white" strokeWidth="7" pointerEvents="none" />
                  <circle r={halfExtent + 7} fill="none" stroke={selectedCircuit.color} strokeWidth="4" pointerEvents="none" />
                </>}
                <PlanDeviceGraphic device={device} assets={assets} display={display} rotation={placement.rotation} color={color} highlighted={selected || connected || circuitHighlighted} />
                {device.status === 'verified' && (
                  <circle cx={appearance.kind === 'symbol' ? 14 : halfExtent - 3} cy={appearance.kind === 'symbol' ? -13 : -halfExtent + 3} r="3.5" fill="#22a76e" stroke="white" strokeWidth="1.5" />
                )}
                <text
                  x="0"
                  y={halfExtent + 14}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#344d40"
                  stroke="white"
                  strokeWidth="3"
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {device.code}
                </text>
              </g>
            );
          })}
        {layers.notes &&
          sheet.annotations.map((note) => (
            <g
              key={note.id}
              transform={`translate(${note.x} ${note.y})`}
              className="floor-note"
              onClick={(e) => {
                e.stopPropagation();
                if (tool !== 'select' && tool !== (note.kind === 'text' ? 'text' : 'note')) return;
                setSelectedNoteId(note.id);
                setSelectedRouteId(null);
                onSelect(null);
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (tool === 'select') {
                  setSelectedNoteId(note.id);
                  onSelect(null);
                  startDrag(e, 'note', note.id, note);
                }
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (note.kind === 'text') return;
                const text = window.prompt(t('Megjegyzés módosítása:'), note.text);
                if (text?.trim())
                  updateSheet((s) => ({
                    ...s,
                    annotations: s.annotations.map((n) => (n.id === note.id ? { ...n, text: text.trim() } : n))
                  }));
              }}
            >
              {note.kind !== 'text' && <rect
                x="-7"
                y="-17"
                width={Math.max(
                  100,
                  note.text.split('\n').reduce((max, line) => Math.max(max, line.length), 0) * 7.2 + 16
                )}
                height={Math.max(28, note.text.split('\n').length * 18 + 10)}
                rx="3"
                fill="#fffbe7"
                stroke={note.id === selectedNoteId ? '#b79733' : '#eadfae'}
                strokeWidth="1"
              />}
              {note.kind === 'text' && <rect x="-4" y={-(note.fontSize ?? 18)} width={Math.max(30, note.text.split('\n').reduce((max, line) => Math.max(max, line.length), 0) * (note.fontSize ?? 18) * .65 + 8)} height={note.text.split('\n').length * (note.fontSize ?? 18) * 1.3} fill="transparent" stroke={note.id === selectedNoteId ? '#28775b' : 'none'} strokeDasharray="4 3" />}
              <text fill={note.kind === 'text' ? note.color ?? '#222222' : '#766534'} fontSize={note.kind === 'text' ? note.fontSize ?? 18 : 12} fontFamily="inherit">
                {note.text.split('\n').map((line, i) => (
                  <tspan key={i} x="0" dy={i ? note.kind === 'text' ? (note.fontSize ?? 18) * 1.3 : 18 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
      </svg>
      {selectedText && (tool === 'select' || tool === 'text') && <div className="floor-text-editor">
        <label>{t('Szöveg')}<textarea aria-label={t('Szöveg')} value={selectedText.text} onChange={(e) => updateSheet((s) => ({ ...s, annotations: s.annotations.map((n) => n.id === selectedText.id ? { ...n, text: e.target.value } : n) }))} /></label>
        <label>{t('Betűméret')}<input type="number" min="6" max="120" value={selectedText.fontSize ?? 18} onChange={(e) => { const size = Number(e.target.value); if (size >= 6 && size <= 120) updateSheet((s) => ({ ...s, annotations: s.annotations.map((n) => n.id === selectedText.id ? { ...n, fontSize: size } : n) })); }} /></label>
        <label>{t('Szín')}<input type="color" value={selectedText.color ?? '#222222'} onChange={(e) => updateSheet((s) => ({ ...s, annotations: s.annotations.map((n) => n.id === selectedText.id ? { ...n, color: e.target.value } : n) }))} /></label>
      </div>}
      <div className="floor-bottom-toolbar">
        <div className="floor-bottom-info">
          <span>
            <MousePointer2 size={13} />
            {dragging ? t('Mozgatás') : t('Húzás: mozgatás · görgetés: nagyítás')}
          </span>
          {sheet.mmPerUnit ? (
            <span>
              <Ruler size={13} />
              {t('{scale} m / 100 egység', {
                scale: ((sheet.mmPerUnit * 100) / 1000).toLocaleString(getLocale(), { maximumFractionDigits: 2 })
              })}
            </span>
          ) : (
            <span>{t('Méretarány nincs beállítva')}</span>
          )}
        </div>
        {selectionHost ? createPortal(selectionTools, selectionHost) : selectionTools}
        <div className="floor-zoom-tools">
          <button
            className="floor-control"
            onClick={() => zoom(1.25)}
            title={t('Kicsinyítés')}
            aria-label={t('Kicsinyítés')}
          >
            <Minus size={17} />
          </button>
          <span>{zoomPercent}%</span>
          <button className="floor-control" onClick={() => zoom(0.8)} title={t('Nagyítás')} aria-label={t('Nagyítás')}>
            <Plus size={17} />
          </button>
          <i />
          <button
            className="floor-control"
            onClick={() => setView(fit())}
            title={t('Teljes tervlap')}
            aria-label={t('Teljes tervlap')}
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default FloorPlan;
