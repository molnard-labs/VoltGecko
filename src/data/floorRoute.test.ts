import { describe, expect, it } from 'vitest';
import type { PlanSheet, Route } from '../types';
import { floorRoutePoints } from './floorRoute';

describe('floor route endpoints', () => {
  const sheet = { placements:[{deviceId:'a',x:10,y:20,rotation:0},{deviceId:'b',x:90,y:80,rotation:0}] } as PlanSheet;
  const route = { id:'r', fromDeviceId:'a', toDeviceId:'b', kind:'power', points:[] } as Route;
  it('uses device positions and preserves legacy intermediate points without duplicating endpoints', () => {
    expect(floorRoutePoints(route,sheet)).toEqual([{x:10,y:20},{x:90,y:80}]);
    expect(floorRoutePoints({...route,points:[{x:10,y:20},{x:40,y:20},{x:90,y:80}]},sheet))
      .toEqual([{x:10,y:20},{x:40,y:20},{x:90,y:80}]);
    expect(floorRoutePoints({...route,points:[{x:30,y:45}]},sheet)).toEqual([{x:10,y:20},{x:30,y:45},{x:90,y:80}]);
    expect(floorRoutePoints({...route,points:[{x:0,y:0},{x:80,y:70}]},sheet))
      .toEqual([{x:10,y:20},{x:0,y:0},{x:80,y:70},{x:90,y:80}]);
  });
  it('does not discard saved points if a device has no placement', () => {
    const points = [{x:4,y:5}];
    expect(floorRoutePoints({...route,fromDeviceId:'missing',points},sheet)).toEqual(points);
  });
});
