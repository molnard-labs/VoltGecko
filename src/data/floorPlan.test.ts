import { describe, expect, it } from 'vitest';
import type { PlanSheet, Point } from '../types';
import { moveSheetBoard, moveSheetDevice } from './floorPlan';

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

describe('moving connected board markers', () => {
  const connected = (): PlanSheet => ({
    id:'s', name:'Sheet', width:500, height:500, annotations:[],
    placements:[{deviceId:'same',x:100,y:100,rotation:0}],
    boardPlacements:[{boardId:'same',x:0,y:0},{boardId:'other',x:200,y:100}],
    routes:[
      {id:'device-link',fromBoardId:'same',toDeviceId:'same',kind:'power',points:[{x:0,y:0},{x:100,y:0},{x:100,y:100}]},
      {id:'board-link',fromBoardId:'other',toBoardId:'same',kind:'control',points:[{x:200,y:100},{x:0,y:100},{x:0,y:0}]}
    ]
  });
  const orthogonal = (points:Point[]) => points.every((point,index) => !index || point.x === points[index-1].x || point.y === points[index-1].y);

  it('moves only the board ends even when a device has the same identifier', () => {
    const original = connected(), before = structuredClone(original);
    const moved = moveSheetBoard(original, 'same', {x:20,y:30});
    expect(moved.boardPlacements?.[0]).toMatchObject({x:20,y:30});
    expect(moved.routes[0].points[0]).toEqual({x:20,y:30});
    expect(moved.routes[0].points.at(-1)).toEqual({x:100,y:100});
    expect(moved.routes[1].points[0]).toEqual({x:200,y:100});
    expect(moved.routes[1].points.at(-1)).toEqual({x:20,y:30});
    expect(moved.routes.every(route => orthogonal(route.points))).toBe(true);
    expect(original).toEqual(before);
  });

  it('moves a device connected to a board while leaving the board end fixed', () => {
    const moved = moveSheetDevice(connected(), 'same', {x:130,y:120});
    expect(moved.routes[0].points[0]).toEqual({x:0,y:0});
    expect(moved.routes[0].points.at(-1)).toEqual({x:130,y:120});
    expect(moved.routes[1]).toEqual(connected().routes[1]);
    expect(orthogonal(moved.routes[0].points)).toBe(true);
  });
});
