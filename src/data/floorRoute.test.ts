import { describe, expect, it } from 'vitest';
import type { PlanSheet, Route } from '../types';
import { floorRouteEndpoint, floorRoutePoints } from './floorRoute';

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
  it('resolves boards in either direction, including IDs shared with devices', () => {
    const withBoards = {...sheet, boardPlacements:[{boardId:'a',x:200,y:300},{boardId:'c',x:400,y:500}]};
    const fromBoard: Route = { id:'b1', fromBoardId:'a', toDeviceId:'a', kind:'power', points:[] };
    expect(floorRouteEndpoint(fromBoard, 'from', withBoards)).toEqual({kind:'board',id:'a',point:{x:200,y:300}});
    expect(floorRoutePoints(fromBoard,withBoards)).toEqual([{x:200,y:300},{x:10,y:20}]);
    expect(floorRoutePoints({id:'b2',fromDeviceId:'b',toBoardId:'c',kind:'control',points:[]},withBoards))
      .toEqual([{x:90,y:80},{x:400,y:500}]);
    expect(floorRoutePoints({id:'b3',fromBoardId:'a',toBoardId:'c',kind:'power',points:[]},withBoards))
      .toEqual([{x:200,y:300},{x:400,y:500}]);
  });
  it('preserves saved points for missing or ambiguous board endpoints', () => {
    const points = [{x:4,y:5}];
    expect(floorRoutePoints({id:'missing',fromBoardId:'missing',toDeviceId:'b',kind:'power',points},sheet)).toEqual(points);
    expect(floorRoutePoints({...route,fromBoardId:'a',points},sheet)).toEqual(points);
  });
});
