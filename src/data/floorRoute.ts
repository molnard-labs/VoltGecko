import type { PlanSheet, Point, Route } from '../types';

const samePoint = (a: Point | undefined, b: Point | undefined) => !!a && !!b && a.x === b.x && a.y === b.y;

/** Include the real device positions while retaining every legacy intermediate point. */
export function floorRoutePoints(route: Route, sheet: PlanSheet): Point[] {
  const from = sheet.placements.find(item => item.deviceId === route.fromDeviceId);
  const to = sheet.placements.find(item => item.deviceId === route.toDeviceId);
  if (!from || !to) return route.points.map(point => ({ ...point }));
  const start = { x: from.x, y: from.y }, end = { x: to.x, y: to.y };
  const points = route.points.map(point => ({ ...point }));
  if (samePoint(points[0], start)) points.shift();
  if (samePoint(points.at(-1), end)) points.pop();
  return [start, ...points, end];
}
