import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { Route } from '../types';
import { floorRouteCircuitId, setDeviceCircuit } from './floorRouteCircuit';
import { createProject } from './project';

describe('floor route circuit resolution', () => {
  it('uses current endpoint assignments even if the route has a stale saved circuit', () => {
    const first = { ...makeDevice('outlet', []), id: 'first', circuitId: 'new' };
    const second = { ...makeDevice('outlet', []), id: 'second', circuitId: 'new' };
    const devices = new Map([[first.id, first], [second.id, second]]);
    const route: Route = { id:'r', kind:'power', points:[], fromDeviceId:first.id, toDeviceId:second.id, circuitId:'old' };
    expect(floorRouteCircuitId(route, devices)).toBe('new');
    second.circuitId = 'other';
    expect(floorRouteCircuitId(route, devices)).toBeUndefined();
  });

  it('follows an assigned endpoint or uses the stored circuit for routes without assigned devices', () => {
    const device = { ...makeDevice('outlet', []), id: 'device', circuitId:'assigned' };
    const devices = new Map([[device.id, device]]);
    const route: Route = { id:'r', kind:'power', points:[], fromBoardId:'board', toDeviceId:device.id, circuitId:'old' };
    expect(floorRouteCircuitId(route, devices)).toBe('assigned');
    expect(floorRouteCircuitId({ ...route, toDeviceId:undefined, toBoardId:'other-board' }, devices)).toBe('old');
    expect(floorRouteCircuitId({ ...route, toDeviceId:undefined, toBoardId:'other-board', circuitId:undefined }, devices)).toBeUndefined();
  });

  it('synchronizes cached routes on reassignment while preserving unrelated legacy and board routes', () => {
    const data = createProject('test').data;
    const a = { ...makeDevice('outlet', []), id:'a', circuitId:'one' };
    const b = { ...makeDevice('outlet', []), id:'b', circuitId:'one' };
    data.devices = [a, b];
    data.sheets[0].routes = [
      {id:'connected',fromDeviceId:'a',toDeviceId:'b',kind:'power',points:[],circuitId:'one'},
      {id:'board',fromBoardId:'x',toBoardId:'y',kind:'power',points:[],circuitId:'legacy'}
    ];
    const conflict = setDeviceCircuit(data, 'a', 'two');
    expect(conflict.sheets[0].routes[0].circuitId).toBeUndefined();
    expect(floorRouteCircuitId(conflict.sheets[0].routes[0], new Map(conflict.devices.map(device => [device.id,device])))).toBeUndefined();
    const unassignedA = setDeviceCircuit(conflict, 'a', undefined);
    expect(unassignedA.sheets[0].routes[0].circuitId).toBe('one');
    const unassignedBoth = setDeviceCircuit(unassignedA, 'b', undefined);
    expect(unassignedBoth.sheets[0].routes[0].circuitId).toBeUndefined();
    expect(unassignedBoth.sheets[0].routes[1].circuitId).toBe('legacy');
    expect(data.sheets[0].routes[0].circuitId).toBe('one');
  });
});
