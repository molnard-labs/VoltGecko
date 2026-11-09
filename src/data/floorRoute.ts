import type { PlanSheet, Point, Route } from '../types';

const samePoint = (a: Point | undefined, b: Point | undefined) => !!a && !!b && a.x === b.x && a.y === b.y;

export type FloorRouteEndpoint = { kind: 'device' | 'board'; id: string; point: Point };

/** Resolve one end on this sheet, without conflating board IDs and device IDs. */
export function floorRouteEndpoint(route: Route, side: 'from' | 'to', sheet: PlanSheet): FloorRouteEndpoint | undefined {
  const deviceId = side === 'from' ? route.fromDeviceId : route.toDeviceId;
  const boardId = side === 'from' ? route.fromBoardId : route.toBoardId;
  if (!!deviceId === !!boardId) return undefined;
  if (deviceId) {
    const item = sheet.placements.find(placement => placement.deviceId === deviceId);
    return item ? { kind:'device', id:deviceId, point:{x:item.x, y:item.y} } : undefined;
  }
  const item = sheet.boardPlacements?.find(placement => placement.boardId === boardId);
  return item && boardId ? { kind:'board', id:boardId, point:{x:item.x, y:item.y} } : undefined;
}

/** Include the real endpoint positions while retaining every legacy intermediate point. */
export function floorRoutePoints(route: Route, sheet: PlanSheet): Point[] {
  const from = floorRouteEndpoint(route, 'from', sheet);
  const to = floorRouteEndpoint(route, 'to', sheet);
  if (!from || !to) return route.points.map(point => ({ ...point }));
  const start = from.point, end = to.point;
  const points = route.points.map(point => ({ ...point }));
  if (samePoint(points[0], start)) points.shift();
  if (samePoint(points.at(-1), end)) points.pop();
  return [start, ...points, end];
}
