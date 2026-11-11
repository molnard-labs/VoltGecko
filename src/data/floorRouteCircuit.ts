import type { Device, ProjectData, Route } from '../types';

/** Resolve a route from current endpoint assignments, falling back to saved legacy data.
 * A route connecting two different assigned circuits is deliberately ambiguous. */
export function floorRouteCircuitId(route: Route, devices: ReadonlyMap<string, Device>): string | undefined {
  if (route.explicitCircuitId) return route.explicitCircuitId;
  const from = route.fromDeviceId ? devices.get(route.fromDeviceId)?.circuitId : undefined;
  const to = route.toDeviceId ? devices.get(route.toDeviceId)?.circuitId : undefined;
  if (from && to && from !== to) return undefined;
  return from || to || route.circuitId;
}

/** Keep cached route assignments consistent after an explicit device reassignment. */
export function setDeviceCircuit(data: ProjectData, deviceId: string, circuitId: string | undefined): ProjectData {
  const current = data.devices.find(device => device.id === deviceId);
  if (!current || current.circuitId === circuitId) return data;
  const devices = data.devices.map(device => device.id === deviceId ? { ...device, circuitId } : device);
  const byId = new Map(devices.map(device => [device.id, device]));
  const sheets = data.sheets.map(sheet => ({ ...sheet, routes: sheet.routes.map(route => {
    if (route.fromDeviceId !== deviceId && route.toDeviceId !== deviceId) return route;
    const resolved = floorRouteCircuitId({ ...route, circuitId: undefined, explicitCircuitId: undefined }, byId);
    const next = { ...route };
    if (resolved) next.circuitId = resolved;
    else delete next.circuitId;
    return next;
  }) }));
  return { ...data, devices, sheets };
}
