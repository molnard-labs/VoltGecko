import type { PlanSheet, Point } from '../types';
import { orthogonalRoute } from '../components/board-wiring/wireEditing';
import { floorRouteEndpoint, floorRoutePoints } from './floorRoute';

/** Move connected route ends without changing which device or board they reference. */
function moveEndpointRoutes(sheet: PlanSheet, kind: 'device' | 'board', id: string, original: Point, point: Point) {
  return sheet.routes.map((route) => {
    const from = floorRouteEndpoint(route, 'from', sheet), to = floorRouteEndpoint(route, 'to', sheet);
    if (!from || !to) return route;
    const fromMatches = from.kind === kind && from.id === id;
    const toMatches = to.kind === kind && to.id === id;
    if (!fromMatches && !toMatches) return route;
    // Older routes can store only interior points or no points at all.
    const previous = floorRoutePoints(route, sheet);
    const points = previous.map((item) => ({ ...item }));
    const index = fromMatches ? 0 : points.length - 1;
    const adjacent = points[index === 0 ? 1 : index - 1];
    if (points.length > 2 && adjacent) {
      if (Math.abs(adjacent.y - original.y) < 0.5) adjacent.y = point.y;
      else if (Math.abs(adjacent.x - original.x) < 0.5) adjacent.x = point.x;
    }
    points[index] = { ...point };
    if (fromMatches && toMatches) points[points.length - 1] = { ...point };
    // Keep the opposite endpoint fixed and preserve right-angle segments.
    return { ...route, points: orthogonalRoute(points, previous) };
  });
}

/** Move a device and its connected floor routes, preserving the opposite endpoints. */
export function moveSheetDevice(sheet: PlanSheet, deviceId: string, point: Point): PlanSheet {
  const original = sheet.placements.find((placement) => placement.deviceId === deviceId);
  if (!original) return sheet;
  return {
    ...sheet,
    placements: sheet.placements.map(placement => placement.deviceId === deviceId ? { ...placement, ...point } : placement),
    routes: moveEndpointRoutes(sheet, 'device', deviceId, original, point)
  };
}

/** Move a board marker and the floor routes connected to it. */
export function moveSheetBoard(sheet: PlanSheet, boardId: string, point: Point): PlanSheet {
  const original = sheet.boardPlacements?.find(placement => placement.boardId === boardId);
  if (!original) return sheet;
  return {
    ...sheet,
    boardPlacements: sheet.boardPlacements?.map(placement => placement.boardId === boardId ? { ...placement, ...point } : placement),
    routes: moveEndpointRoutes(sheet, 'board', boardId, original, point)
  };
}
