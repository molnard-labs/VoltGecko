import { describe, expect, it } from 'vitest';
import { insertWireBend, moveWireBend, moveWireSegment, orthogonalRoute, removeWireBend, snapWirePoint } from './wireEditing';

const orthogonal = (route: {x:number;y:number}[]) => route.every((point, i) => !i || point.x === route[i-1].x || point.y === route[i-1].y);

describe('wire routing edits', () => {
  it('snaps an edited bend and preserves exact off-grid terminals with orthogonal segments', () => {
    const before = [{x:13,y:17},{x:13,y:56},{x:94,y:56},{x:94,y:103}];
    const after = [before[0], snapWirePoint({x:38,y:63}), before[2], before[3]];
    const route = orthogonalRoute(after, before);
    expect(route[0]).toEqual(before[0]);
    expect(route.at(-1)).toEqual(before.at(-1));
    expect(route).toContainEqual({x:40,y:60});
    for (let i=1; i<route.length; i++) expect(route[i].x === route[i-1].x || route[i].y === route[i-1].y).toBe(true);
  });
  it('inserts the bend into the longest segment while keeping the path unchanged', () => {
    const route = [{x:13,y:17},{x:13,y:53},{x:103,y:53},{x:103,y:83}];
    expect(insertWireBend(route, true)).toEqual([{x:13,y:53},{x:60,y:53},{x:103,y:53}]);
  });
  it('removes the chosen bend without reintroducing it and preserves right angles', () => {
    const route = [{x:0,y:0},{x:0,y:50},{x:100,y:50},{x:100,y:100}];
    expect(removeWireBend(route, 0, true)).toEqual([{x:0,y:100}]);
    expect(removeWireBend(route, 0, false)).toEqual([{x:0,y:100}]);
  });
  it('keeps the necessary last corner and removes collinear points without inventing a corner', () => {
    const elbow = [{x:3,y:7},{x:3,y:53},{x:103,y:53}];
    expect(removeWireBend(elbow, 0, true)).toEqual([elbow[1]]);
    expect(removeWireBend([{x:0,y:0},{x:30,y:0},{x:80,y:0}], 0, false)).toEqual([]);
  });
  it('deletes a corner next to a straight continuation rather than retaining it as the replacement corner', () => {
    const route = [{x:0,y:0},{x:100,y:0},{x:100,y:50},{x:100,y:100}];
    const result = [route[0], ...removeWireBend(route, 0, true), route.at(-1)!];
    expect(result).toEqual([{x:0,y:0},{x:0,y:100},{x:100,y:100}]);
    expect(result).not.toContainEqual(route[1]);
  });
  it('slides a corner and adjacent edges without moving fixed terminals, snapped or unsnapped', () => {
    const route = [{x:13,y:17},{x:13,y:56},{x:94,y:56},{x:94,y:103}];
    for (const snap of [false, true]) {
      const result = moveWireBend(route, 1, {x:38,y:63}, snap);
      expect(result.route[0]).toEqual(route[0]);
      expect(result.route.at(-1)).toEqual(route.at(-1));
      expect(result.route[result.index]).toEqual(snap ? {x:40,y:60} : {x:38,y:63});
      expect(orthogonal(result.route)).toBe(true);
      // Repeated pointer frames each use the original shape and cannot accumulate bends.
      expect(moveWireBend(route, 1, {x:38,y:63}, snap)).toEqual(result);
    }
  });
  it('moves an interior segment perpendicularly without changing its ends or other runs', () => {
    const route = [{x:13,y:17},{x:13,y:56},{x:94,y:56},{x:94,y:103}];
    const result = moveWireSegment(route, 1, {x:999,y:73}, true);
    expect(result.route).toEqual([{x:13,y:17},{x:13,y:70},{x:94,y:70},{x:94,y:103}]);
    expect(result.index).toBe(1);
    expect(orthogonal(result.route)).toBe(true);
  });
  it('inserts attachment elbows when moving a segment adjacent to a fixed terminal', () => {
    const route = [{x:13,y:17},{x:13,y:56},{x:94,y:56}];
    const result = moveWireSegment(route, 0, {x:38,y:999}, false);
    expect(result.route).toEqual([{x:13,y:17},{x:38,y:17},{x:38,y:56},{x:94,y:56}]);
    expect(result.index).toBe(1);
    expect(orthogonal(result.route)).toBe(true);
  });
  it('keeps all point and segment edits orthogonal across varied off-grid positions', () => {
    const route = [{x:13,y:17},{x:13,y:56},{x:94,y:56},{x:94,y:103}];
    for (const snap of [true, false]) for (const x of [-20,0,13,25,94,150]) for (const y of [-20,17,56,73,103,150]) {
      for (const i of [1,2]) {
        const result=moveWireBend(route,i,{x,y},snap).route;
        expect(orthogonal(result)).toBe(true);
        expect(result[0]).toEqual(route[0]); expect(result.at(-1)).toEqual(route.at(-1));
      }
      for (const i of [0,1,2]) {
        const result=moveWireSegment(route,i,{x,y},snap).route;
        expect(orthogonal(result)).toBe(true);
        expect(result[0]).toEqual(route[0]); expect(result.at(-1)).toEqual(route.at(-1));
      }
    }
  });
  it('lets a dragged corner move away again after it lands on a neighbouring corner', () => {
    const route = [{x:0,y:0},{x:0,y:50},{x:100,y:50},{x:100,y:100}];
    const coincident = moveWireBend(route, 1, {x:100,y:50}, false);
    expect(coincident.route[coincident.index]).toEqual({x:100,y:50});
    const movedAgain = moveWireBend(coincident.route, coincident.index, {x:70,y:80}, false);
    expect(movedAgain.route[movedAgain.index]).toEqual({x:70,y:80});
    expect(orthogonal(movedAgain.route)).toBe(true);
    expect(movedAgain.route[0]).toEqual(route[0]);
    expect(movedAgain.route.at(-1)).toEqual(route.at(-1));
  });
  it('preserves endpoints and selected indices through varied orthogonal and coincident paths', () => {
    let seed = 123456789;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed; };
    for (let trial=0; trial<600; trial++) {
      const route = [{x:(random()%40)-20,y:(random()%40)-20}];
      for(let j=0;j<5;j++) {
        const last=route[route.length-1], delta=(random()%6===0?0:(random()%61)-30);
        route.push((random() >>> 16)%2 ? {x:last.x+delta,y:last.y} : {x:last.x,y:last.y+delta});
      }
      const target = {x:(random()%101)-50,y:(random()%101)-50};
      for(const snap of [false,true]) {
        for(let i=1;i<route.length-1;i++) {
          const result=moveWireBend(route,i,target,snap);
          expect(orthogonal(result.route)).toBe(true);
          expect(result.route[0]).toEqual(route[0]); expect(result.route.at(-1)).toEqual(route.at(-1));
          expect(result.index).toBeGreaterThan(0); expect(result.index).toBeLessThan(result.route.length-1);
          if (!((route[i].x===target.x&&route[i].y===target.y) || (snap && sameSnap(route[i],target))))
            expect(result.route[result.index]).toEqual(snap?snapWirePoint(target):target);
        }
        for(let i=0;i<route.length-1;i++) {
          const result=moveWireSegment(route,i,target,snap);
          expect(orthogonal(result.route)).toBe(true);
          expect(result.route[0]).toEqual(route[0]); expect(result.route.at(-1)).toEqual(route.at(-1));
          expect(result.index).toBeGreaterThanOrEqual(0); expect(result.index).toBeLessThan(result.route.length-1);
        }
        for(let i=0;i<route.length-2;i++) {
          const points = removeWireBend(route,i,snap);
          const result = [route[0],...points,route.at(-1)!];
          expect(orthogonal(result)).toBe(true);
          expect(result[0]).toEqual(route[0]); expect(result.at(-1)).toEqual(route.at(-1));
          expect(points.length).toBeLessThanOrEqual(route.length-2);
        }
      }
    }
  });
});

function sameSnap(a:{x:number;y:number}, b:{x:number;y:number}):boolean { const p=snapWirePoint(b);return a.x===p.x&&a.y===p.y; }
