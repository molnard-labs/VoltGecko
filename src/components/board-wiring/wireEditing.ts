import type { Point } from '../../types';

export const WIRING_GRID_SIZE = 10;

export function snapWirePoint(point: Point): Point {
  return { x: Math.round(point.x / WIRING_GRID_SIZE) * WIRING_GRID_SIZE, y: Math.round(point.y / WIRING_GRID_SIZE) * WIRING_GRID_SIZE };
}

/** Keep terminal positions exact and insert elbows wherever a segment would be diagonal. */
export function orthogonalRoute(points: Point[], previous = points): Point[] {
  if (points.length < 2) return points.slice();
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (a.x !== b.x && a.y !== b.y) {
      const oldA = previous[i - 1], oldB = previous[i];
      const wasVertical = oldA && oldB && oldA.x === oldB.x;
      const wasHorizontal = oldA && oldB && oldA.y === oldB.y;
      const verticalFirst = wasVertical || (!wasHorizontal && Math.abs(b.y - a.y) >= Math.abs(b.x - a.x));
      result.push(verticalFirst ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
    }
    result.push(b);
  }
  return result;
}

/** Add a draggable point to the longest existing segment without changing its shape. */
export function insertWireBend(route: Point[], snap: boolean): Point[] {
  if (route.length < 2) return [];
  let longest = 0;
  for (let i = 1; i < route.length - 1; i++)
    if (Math.hypot(route[i + 1].x - route[i].x, route[i + 1].y - route[i].y) >
      Math.hypot(route[longest + 1].x - route[longest].x, route[longest + 1].y - route[longest].y)) longest = i;
  const a = route[longest], b = route[longest + 1];
  let point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (snap) {
    const snapped = snapWirePoint(point);
    // The fixed coordinate must stay on the segment even when terminals are off-grid.
    if (a.x === b.x) point = { x: a.x, y: Math.max(Math.min(a.y, b.y), Math.min(Math.max(a.y, b.y), snapped.y)) };
    else if (a.y === b.y) point = { x: Math.max(Math.min(a.x, b.x), Math.min(Math.max(a.x, b.x), snapped.x)), y: a.y };
  }
  if ((point.x === a.x && point.y === a.y) || (point.x === b.x && point.y === b.y))
    point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const points = route.slice(1, -1);
  points.splice(longest, 0, point);
  return points;
}

/** Remove the selected bend; if a right-angle replacement is needed use the other corner. */
export function removeWireBend(route: Point[], index: number, snap: boolean): Point[] {
  const absoluteIndex = index + 1;
  if (absoluteIndex <= 0 || absoluteIndex >= route.length - 1) return route.slice(1, -1);
  const a = route[absoluteIndex - 1], b = route[absoluteIndex], c = route[absoluteIndex + 1];
  const replacement: Point[] = [];
  if (snap && a.x !== c.x && a.y !== c.y) {
    const first = {x:a.x, y:c.y}, second = {x:c.x, y:a.y};
    replacement.push(first.x === b.x && first.y === b.y ? second : first);
  }
  const result = [...route.slice(0, absoluteIndex), ...replacement, ...route.slice(absoluteIndex + 1)];
  return (snap ? orthogonalRoute(result) : result).slice(1, -1);
}
