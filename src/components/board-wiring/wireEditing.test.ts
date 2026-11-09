import { describe, expect, it } from 'vitest';
import { insertWireBend, orthogonalRoute, removeWireBend, snapWirePoint } from './wireEditing';

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
    expect(removeWireBend(route, 0, true)).toEqual([{x:100,y:0},{x:100,y:50}]);
    expect(removeWireBend(route, 0, false)).toEqual([{x:100,y:50}]);
  });
});
