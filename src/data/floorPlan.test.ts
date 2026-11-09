import { describe, expect, it } from 'vitest';
import type { PlanSheet, Point } from '../types';
import { moveSheetDevice } from './floorPlan';

function sheet(points: Point[]): PlanSheet {
  return {
    id: 'sheet',
    name: 'Sheet',
    width: 500,
    height: 500,
    annotations: [],
    placements: [
      { deviceId: 'from', x: 0, y: 0, rotation: 0 },
      { deviceId: 'to', x: 100, y: 0, rotation: 0 }
    ],
    routes: [{ id: 'route', fromDeviceId: 'from', toDeviceId: 'to', kind: 'power', points }]
  };
}

describe('floor-plan device movement', () => {
  it.each(['from', 'to'])('preserves the opposite device endpoint of a two-point route when moving %s', (deviceId) => {
    const original = sheet([
      { x: 0, y: 0 },
      { x: 100, y: 0 }
    ]);
    const before = structuredClone(original);
    const moved = moveSheetDevice(original, deviceId, { x: 30, y: 40 });
    expect(moved.placements.find((placement) => placement.deviceId === deviceId)).toMatchObject({ x: 30, y: 40 });
    expect(moved.routes[0].points).toEqual(
      deviceId === 'from'
        ? [
            { x: 30, y: 40 },
            { x: 100, y: 40 },
            { x: 100, y: 0 }
          ]
        : [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 40 }
          ]
    );
    expect(original).toEqual(before);
  });

  it('keeps every segment orthogonal when moving a device on an older diagonal route', () => {
    const original = sheet([{x:0,y:0}, {x:40,y:20}, {x:100,y:0}]);
    const moved = moveSheetDevice(original, 'from', {x:10,y:30});
    const points = moved.routes[0].points;
    expect(points[0]).toEqual({x:10,y:30});
    expect(points.at(-1)).toEqual({x:100,y:0});
    expect(points.every((point,index) => !index || point.x === points[index-1].x || point.y === points[index-1].y)).toBe(true);
  });

  it('preserves a legacy route with interior-only points when moving either device', () => {
    const original = sheet([{x:40,y:20}]);
    const moved = moveSheetDevice(original, 'from', {x:10,y:30});
    const points = moved.routes[0].points;
    expect(points[0]).toEqual({x:10,y:30});
    expect(points.at(-1)).toEqual({x:100,y:0});
    expect(points).toContainEqual({x:40,y:20});
    expect(points.every((point,index) => !index || point.x === points[index-1].x || point.y === points[index-1].y)).toBe(true);
  });

  it('creates an orthogonal route when a connected device moves on an empty legacy path', () => {
    const moved = moveSheetDevice(sheet([]), 'to', {x:30,y:40});
    expect(moved.routes[0].points).toEqual([{x:0,y:0},{x:30,y:0},{x:30,y:40}]);
  });

  it('moves the adjacent bend to retain the route end alignment without moving the far endpoint', () => {
    const original = sheet([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 100 },
      { x: 100, y: 100 }
    ]);
    original.placements[1].y = 100;
    const moved = moveSheetDevice(original, 'from', { x: 10, y: 20 });
    expect(moved.routes[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 100 },
      { x: 100, y: 100 }
    ]);
  });
});
