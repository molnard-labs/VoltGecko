import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { floorRouteCircuitId } from '../data/floorRouteCircuit';
import { isBoardRouteTerminalCompatible } from '../data/boardRouteConnections';
import { projectPhases } from '../data/projectPhases';
import { wiringEndpointLabel } from '../data/boardWiring';
import type { Board, Conductor, PlanSheet, ProjectData, Route, WiringEndpoint } from '../types';
import { encodeEndpoint, getEndpointOptions, parseEndpoint } from './board-wiring/endpoints';
import './floor-board-routes.css';

interface Props { data: ProjectData; board: Board; onChange: (data: ProjectData) => void }

function RouteCard({ data, board, sheet, route, onChange }: Props & { sheet: PlanSheet; route: Route }) {
  const [conductor, setConductor] = useState<Conductor>('L');
  const [newEndpoint, setNewEndpoint] = useState('');
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const routeCircuitId = floorRouteCircuitId(route, devices);
  const inferred = data.circuits.find(circuit => circuit.id === routeCircuitId);
  const endpoints = getEndpointOptions(data).filter(option => option.group === board.id);
  const terminalOptions = (wire: Conductor) => endpoints.filter(option => isBoardRouteTerminalCompatible(data, board.id, wire, option.value));
  const routeTerminals = (route.boardTerminals ?? []).filter(item => item.boardId === board.id);
  const used = new Set(routeTerminals.map(item => item.conductor));
  const conductors: Conductor[] = [...projectPhases(data), 'N', 'PE', 'PEN'];
  const availableConductors = conductors.filter(item => !used.has(item));
  const chosenConductor = availableConductors.includes(conductor) ? conductor : availableConductors[0];
  const canAdd = !!chosenConductor && !!newEndpoint && terminalOptions(chosenConductor).some(option => encodeEndpoint(option.value) === newEndpoint);
  const routeSideName = (deviceId?: string, boardId?: string) => {
    const device = deviceId ? devices.get(deviceId) : undefined;
    return device ? `${device.code} · ${device.name}` : data.boards.find(item => item.id === boardId)?.name ?? t('Ismeretlen végpont');
  };
  const endName = route.fromBoardId === board.id
    ? routeSideName(route.toDeviceId, route.toBoardId)
    : routeSideName(route.fromDeviceId, route.fromBoardId);
  const otherCircuits = [route.fromDeviceId, route.toDeviceId]
    .flatMap(id => id ? [devices.get(id)] : [])
    .filter(device => device?.circuitId && route.explicitCircuitId && device.circuitId !== route.explicitCircuitId);
  const patch = (mutate: (target: Route) => void) => {
    const next = structuredClone(data);
    const target = next.sheets.find(item => item.id === sheet.id)?.routes.find(item => item.id === route.id);
    if (!target) return;
    mutate(target);
    onChange(next);
  };
  const setTerminal = (wire: Conductor, endpoint: WiringEndpoint | undefined) => patch(target => {
    const remaining = (target.boardTerminals ?? []).filter(item => item.boardId !== board.id || item.conductor !== wire);
    if (endpoint) remaining.push({ boardId: board.id, conductor: wire, endpoint });
    if (remaining.length) target.boardTerminals = remaining;
    else delete target.boardTerminals;
  });
  return <article className="floor-board-route-card" data-testid="floor-board-route-card">
    <h4>{sheet.name} · {endName}</h4>
    <p className="subtle">{t(route.kind === 'control' ? 'Vezérlés' : 'Tápellátás')}</p>
    <label>{t('Nyomvonal áramköre')}
      <select aria-label={t('{sheet} · {endpoint}: nyomvonal áramköre', { sheet: sheet.name, endpoint: endName })}
        value={route.explicitCircuitId ?? ''}
        onChange={event => patch(target => { if (event.target.value) target.explicitCircuitId = event.target.value; else delete target.explicitCircuitId; })}>
        <option value="">{inferred && !route.explicitCircuitId ? t('Automatikus: {circuit}', { circuit: `${inferred.code} · ${inferred.name}` }) : t('Automatikus / nincs hozzárendelve')}</option>
        {data.circuits.map(circuit => <option key={circuit.id} value={circuit.id}>{circuit.code} · {circuit.name}</option>)}
      </select>
    </label>
    {!data.circuits.length && <p className="subtle">{t('Új áramkört az Áramkörök oldalon hozhatsz létre.')}</p>}
    {otherCircuits.length > 0 && <p className="input-warning" role="alert">{t('A nyomvonalhoz választott áramkör eltér a csatlakozó eszköz áramkörétől. Az eszköz hozzárendelése nem változott.')}</p>}
    <div className="floor-board-route-terminals">
      <strong>{t('Kapocshoz rendelt vezetők')}</strong>
      {routeTerminals.length === 0 && <p className="subtle">{t('Még nincs kapocshoz rendelt vezető.')}</p>}
      {routeTerminals.map(item => {
        const options = terminalOptions(item.conductor);
        const value = encodeEndpoint(item.endpoint);
        const valid = options.some(option => encodeEndpoint(option.value) === value);
        return <div className="floor-board-terminal" key={item.conductor}>
          <label>{item.conductor}
            <select aria-label={t('{conductor} kapcsa: {sheet} · {endpoint}', { conductor:item.conductor, sheet:sheet.name, endpoint:endName })} value={value}
              onChange={event => setTerminal(item.conductor, parseEndpoint(event.target.value))}>
              {!valid && <option value={value}>{wiringEndpointLabel(data, item.endpoint)} · {t('Ellenőrizd a kapcsot')}</option>}
              {options.map(option => <option key={encodeEndpoint(option.value)} value={encodeEndpoint(option.value)}>{option.text}</option>)}
            </select>
          </label>
          <button type="button" className="icon-button danger-hover" aria-label={t('{conductor} kapocs-hozzárendelés törlése', {conductor:item.conductor})} title={t('Hozzárendelés törlése')} onClick={() => setTerminal(item.conductor, undefined)}><Trash2 size={16}/></button>
          {!valid && <p className="input-warning" role="alert">{t('Ez a kapocs már nem érhető el vagy a vezető típusa megváltozott.')}</p>}
        </div>;
      })}
      {availableConductors.length > 0 && <div className="floor-board-terminal-add">
        <label>{t('Vezető')}
          <select aria-label={t('Új vezető: {sheet} · {endpoint}', {sheet:sheet.name,endpoint:endName})} value={chosenConductor ?? ''} onChange={event => { setConductor(event.target.value as Conductor); setNewEndpoint(''); }}>
            {availableConductors.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label>{t('Elosztó kapcsa')}
          <select aria-label={t('Új vezető kapcsa: {sheet} · {endpoint}', {sheet:sheet.name,endpoint:endName})} value={canAdd ? newEndpoint : ''} onChange={event => setNewEndpoint(event.target.value)}>
            <option value="">{t('Csatlakozópont kiválasztása')}</option>
            {terminalOptions(chosenConductor).map(option => <option key={encodeEndpoint(option.value)} value={encodeEndpoint(option.value)}>{option.text}</option>)}
          </select>
        </label>
        <button type="button" className="quiet" disabled={!canAdd} onClick={() => { setTerminal(chosenConductor, parseEndpoint(newEndpoint)); setNewEndpoint(''); }}><Plus size={15}/>{t('Vezető hozzárendelése')}</button>
      </div>}
      {chosenConductor && !terminalOptions(chosenConductor).length && <p className="subtle">{t('Nincs az elosztóban ehhez a vezetőhöz illő kapocs.')}</p>}
    </div>
  </article>;
}

export function FloorBoardRoutes({ data, board, onChange }: Props) {
  const routes = data.sheets.flatMap(sheet => sheet.routes.filter(route => route.fromBoardId === board.id || route.toBoardId === board.id).map(route => ({sheet, route})));
  return <section className="floor-board-routes" aria-label={t('Alaprajzi nyomvonalak')}>
    <h3>{t('Alaprajzi nyomvonalak')} <span className="small-tag">{routes.length}</span></h3>
    <p className="subtle">{t('Az elosztóhoz az alaprajzon csatlakoztatott nyomvonalak. A vezetőket külön rendeld az elosztó megfelelő kapcsaihoz.')}</p>
    {!routes.length && <p className="subtle">{t('Ehhez az elosztóhoz még nincs alaprajzi nyomvonal.')}</p>}
    {routes.map(({sheet,route}) => <RouteCard key={`${sheet.id}:${route.id}`} data={data} board={board} sheet={sheet} route={route} onChange={onChange}/>)}
  </section>;
}
