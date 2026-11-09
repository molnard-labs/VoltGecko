import type { PlanSheet, Point } from '../types';
import { orthogonalRoute } from '../components/board-wiring/wireEditing';
import { floorRoutePoints } from './floorRoute';

/** Move a placement and its connected route ends, retaining adjacent right-angle bends. */
export function moveSheetDevice(sheet: PlanSheet, deviceId: string, point: Point): PlanSheet {
  const original = sheet.placements.find((placement) => placement.deviceId === deviceId);
  if (!original) return sheet;
  return {
    ...sheet,
    placements: sheet.placements.map((placement) =>
      placement.deviceId === deviceId ? { ...placement, ...point } : placement
    ),
    routes: sheet.routes.map((route) => {
      if (route.fromDeviceId !== deviceId && route.toDeviceId !== deviceId) return route;
      if (!sheet.placements.some(item => item.deviceId === route.fromDeviceId) ||
          !sheet.placements.some(item => item.deviceId === route.toDeviceId)) return route;
      // Legacy routes can store only interior points or no points at all.
      // Materialize the actual endpoints before moving either device.
      const previous = floorRoutePoints(route, sheet);
      const points = previous.map((item) => ({ ...item }));
      const index = route.fromDeviceId === deviceId ? 0 : points.length - 1;
      const adjacent = points[index === 0 ? 1 : index - 1];
      // In a two-point route the adjacent point belongs to the opposite device.
      if (points.length > 2 && adjacent) {
        if (Math.abs(adjacent.y - original.y) < 0.5) adjacent.y = point.y;
        else if (Math.abs(adjacent.x - original.x) < 0.5) adjacent.x = point.x;
      }
      points[index] = { ...point };
      // Moving either end must never leave a diagonal segment, including a
      // previously straight two-point connection. Keep the opposite endpoint fixed.
      return { ...route, points: orthogonalRoute(points, previous) };
    })
  };
}
