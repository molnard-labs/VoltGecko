import type { Point } from '../../types';

export const WIRING_GRID_SIZE = 10;

export function snapWirePoint(point: Point): Point {
  return { x: Math.round(point.x / WIRING_GRID_SIZE) * WIRING_GRID_SIZE, y: Math.round(point.y / WIRING_GRID_SIZE) * WIRING_GRID_SIZE };
}

type RouteEdit = { route: Point[]; index: number };
const samePoint = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const horizontal = (a: Point, b: Point) => a.y === b.y && a.x !== b.x;
const vertical = (a: Point, b: Point) => a.x === b.x && a.y !== b.y;

/** Move a bend while preserving the adjacent edges' directions where possible.
 * Endpoint coordinates never move. Use the original route for each drag frame. */
export function moveWireBend(route: Point[], index: number, target: Point, snap: boolean): RouteEdit {
  if (index < 1 || index >= route.length - 1 || samePoint(route[index], target)) return { route: route.slice(), index };
  const point = snap ? snapWirePoint(target) : target;
  const previous = route[index - 1], current = route[index], next = route[index + 1];
  if (samePoint(current, point)) return { route: route.slice(), index };
  // A dragged point may coincide with an adjacent corner or terminal. Infer
  // that zero-length edge's direction from the nearest nonzero run instead of
  // trapping the handle at the coincident position.
  const beforeDistinct = route.slice(0, index).reverse().find(item => !samePoint(item, current));
  const afterDistinct = route.slice(index + 1).find(item => !samePoint(item, current));
  const incomingVertical = vertical(previous, current) || (samePoint(previous, current) &&
    (beforeDistinct ? vertical(beforeDistinct, current) : afterDistinct ? vertical(current, afterDistinct) : false));
  const incomingHorizontal = horizontal(previous, current) || (samePoint(previous, current) && !incomingVertical);
  const outgoingVertical = vertical(current, next) || (samePoint(current, next) &&
    (afterDistinct ? vertical(current, afterDistinct) : incomingVertical));
  const outgoingHorizontal = horizontal(current, next) || (samePoint(current, next) && !outgoingVertical);
  if ((!incomingVertical && !incomingHorizontal) || (!outgoingVertical && !outgoingHorizontal))
    return { route: route.slice(), index };

  const before = route.slice(0, index), after = route.slice(index + 1);
  // Slide the neighbour along its other edge; at a fixed end or a straight
  // continuation insert an elbow instead of moving unrelated geometry.
  const beforePoint = incomingVertical ? { x: point.x, y: previous.y } : { x: previous.x, y: point.y };
  if (!samePoint(previous, beforePoint)) {
    const prior = route[index - 2];
    if (prior && ((horizontal(prior, previous) && incomingVertical) || (vertical(prior, previous) && incomingHorizontal)))
      before[before.length - 1] = beforePoint;
    else {
      const elbow = incomingVertical ? { x: previous.x, y: point.y } : { x: point.x, y: previous.y };
      if (!samePoint(previous, elbow) && !samePoint(elbow, point)) before.push(elbow);
    }
  }
  const afterPoint = outgoingVertical ? { x: point.x, y: next.y } : { x: next.x, y: point.y };
  if (!samePoint(next, afterPoint)) {
    const following = route[index + 2];
    if (following && ((outgoingVertical && horizontal(next, following)) || (outgoingHorizontal && vertical(next, following))))
      after[0] = afterPoint;
    else {
      const elbow = outgoingVertical ? { x: next.x, y: point.y } : { x: point.x, y: next.y };
      if (!samePoint(next, elbow) && !samePoint(elbow, point)) after.unshift(elbow);
    }
  }
  // If the dragged point coincides with its neighbour, retain the explicit
  // handle. The next move can still pull it away without moving an endpoint.
  return { route: [...before, point, ...after], index: before.length };
}

/** Shift a segment perpendicular to itself, keeping its endpoints attached. */
export function moveWireSegment(route: Point[], index: number, target: Point, snap: boolean): RouteEdit {
  if (index < 0 || index >= route.length - 1) return { route: route.slice(), index };
  const a = route[index], b = route[index + 1];
  const isHorizontal = horizontal(a, b), isVertical = vertical(a, b);
  if (!isHorizontal && !isVertical) return { route: route.slice(), index };
  const requested = isHorizontal ? target.y : target.x;
  const coordinate = snap ? Math.round(requested / WIRING_GRID_SIZE) * WIRING_GRID_SIZE : requested;
  if (coordinate === (isHorizontal ? a.y : a.x)) return { route: route.slice(), index };
  const movedA = isHorizontal ? { x: a.x, y: coordinate } : { x: coordinate, y: a.y };
  const movedB = isHorizontal ? { x: b.x, y: coordinate } : { x: coordinate, y: b.y };
  const before = route.slice(0, index + 1), after = route.slice(index + 1);
  const previous = route[index - 1], following = route[index + 2];
  if (previous && (isHorizontal ? vertical(previous, a) : horizontal(previous, a))) before[before.length - 1] = movedA;
  else before.push(movedA);
  if (following && (isHorizontal ? vertical(b, following) : horizontal(b, following))) after[0] = movedB;
  else after.unshift(movedB);
  return { route: [...before, ...after], index: before.length - 1 };
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

/** Remove a bend, simplifying a neighbouring corner when a direct edge is impossible. */
export function removeWireBend(route: Point[], index: number, _snap: boolean): Point[] {
  const absoluteIndex = index + 1;
  if (absoluteIndex <= 0 || absoluteIndex >= route.length - 1) return route.slice(1, -1);
  const a = route[absoluteIndex - 1], b = route[absoluteIndex], c = route[absoluteIndex + 1];
  if (a.x === c.x || a.y === c.y)
    return [...route.slice(0, absoluteIndex), ...route.slice(absoluteIndex + 1)].slice(1, -1);
  // A single corner between diagonal terminals is mathematically necessary.
  if (route.length === 3) return route.slice(1, -1);
  if (absoluteIndex + 2 < route.length) {
    const d = route[absoluteIndex + 2];
    let corner = vertical(a, b) ? {x:a.x, y:d.y} : {x:d.x, y:a.y};
    if (samePoint(corner, b)) corner = vertical(a, b) ? {x:d.x, y:a.y} : {x:a.x, y:d.y};
    const replacement = samePoint(a, corner) || samePoint(d, corner) ? [] : [corner];
    return [...route.slice(0, absoluteIndex), ...replacement, ...route.slice(absoluteIndex + 2)].slice(1, -1);
  }
  const z = route[absoluteIndex - 2];
  let corner = vertical(z, a) ? {x:z.x, y:c.y} : {x:c.x, y:z.y};
  if (samePoint(corner, b)) corner = vertical(z, a) ? {x:c.x, y:z.y} : {x:z.x, y:c.y};
  const replacement = samePoint(z, corner) || samePoint(c, corner) ? [] : [corner];
  return [...route.slice(0, absoluteIndex - 1), ...replacement, ...route.slice(absoluteIndex + 1)].slice(1, -1);
}
