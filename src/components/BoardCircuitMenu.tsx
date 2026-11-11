import { t } from '../i18n';
import { adoptUnassignedLegacyBoardRoute, assignCircuitBoardTerminal, circuitEndpointKey, getCircuitBoardConnections, getUnassignedLegacyBoardRoutes, setCircuitBoardPosition, setCircuitBoardVisible, setCircuitBoardsVisible } from '../data/circuitBoard';
import { isBoardRouteTerminalCompatible } from '../data/boardRouteConnections';
import { wiringEndpointLabel } from '../data/boardWiring';
import type { ProjectData } from '../types';

/** Select the circuits shown on this cabinet without changing other boards. */
export function BoardCircuitMenu({ data, boardId, onChange, onOpenCircuits }: {
  data: ProjectData; boardId: string; onChange: (data: ProjectData) => void; onOpenCircuits: () => void;
}) {
  if (!data.boards.some(board => board.id === boardId)) return null;
  const shown = getCircuitBoardConnections(data, boardId);
  // Historical conflicts must remain resolvable even if a circuit is hidden.
  const withConflicts = getCircuitBoardConnections(data, boardId, {includeGloballyHidden:true,includeLocallyHidden:true});
  const orphaned = getUnassignedLegacyBoardRoutes(data, boardId);
  const visible = new Set(shown.map(item => item.circuit.id));
  const hasConflicts = orphaned.length > 0 || withConflicts.some(({connection}) => connection.legacyPositionConflict || connection.legacyTerminalConflicts?.length);
  return <details className="board-circuit-menu">
    <summary>{t('Áramkörök az elosztón')} {hasConflicts && <span aria-label={t('Korábbi bekötést ellenőrizni kell')}>⚠</span>}</summary>
    <div className="board-circuit-menu-content">
      <p>{t('Válaszd ki, mely áramkörök jelenjenek meg ebben az elosztóban.')}</p>
      {!data.circuits.length && <button type="button" className="quiet" onClick={onOpenCircuits}>{t('Áramkörök létrehozása')}</button>}
      {data.circuits.map(circuit => <label className="board-circuit-menu-item" key={circuit.id}>
        <input type="checkbox" checked={visible.has(circuit.id)} onChange={event => {
          const checked = event.target.checked;
          const next = checked ? setCircuitBoardsVisible(data,circuit.id,true) : data;
          onChange(setCircuitBoardVisible(next,circuit.id,boardId,checked));
        }}/>
        <span>{circuit.code} · {circuit.name}{circuit.hideOnBoards ? ` · ${t('Minden elosztón rejtett')}` : ''}</span>
      </label>)}
      {orphaned.map(({sheet,route},index) => {
        const fromBoard = route.fromBoardId === boardId;
        const device = data.devices.find(item => item.id === (fromBoard ? route.toDeviceId : route.fromDeviceId));
        const otherBoard = data.boards.find(item => item.id === (fromBoard ? route.toBoardId : route.fromBoardId));
        const target = device ? `${device.code} · ${device.name}` : otherBoard?.name ?? '—';
        const description = t('Korábbi bekötés {number} · {sheet} · {target}', {number:index+1,sheet:sheet.name,target});
        return <label className="board-circuit-conflict" key={`${sheet.id}:${route.id}`}>
        <span>{description}: {t('Válaszd ki az áramkörét')}</span>
        <select aria-label={description} value="" onChange={event => {
          if (event.target.value) onChange(adoptUnassignedLegacyBoardRoute(data,sheet.id,route.id,boardId,event.target.value));
        }}>
          <option value="">{t('Áramkör kiválasztása')}</option>
          {data.circuits.map(circuit => <option key={circuit.id} value={circuit.id}>{circuit.code} · {circuit.name}</option>)}
        </select>
      </label>;})}
      {withConflicts.map(({circuit,connection}) => <div key={circuit.id}>
        {connection.legacyPositionConflict && <div className="board-circuit-conflict input-warning">
          <p>{t('{circuit}: a korábbi helyek eltértek. Helyezd el újra az áramkört.', {circuit:circuit.code})}</p>
          {connection.legacyPositionOptions?.map((point,index) => <button type="button" className="quiet" key={`${point.x}:${point.y}`}
            onClick={() => onChange(setCircuitBoardPosition(data,circuit.id,boardId,point))}>{t('{number}. korábbi hely használata', {number:index+1})}</button>)}
        </div>}
        {connection.legacyTerminalConflicts?.map(conflict => <div className="board-circuit-conflict" key={conflict.conductor} role="alert">
          <p>{t('{circuit}: a korábbi {conductor} bekötések eltérnek. Válaszd ki a megfelelő kapcsot.', {circuit:circuit.code,conductor:conflict.conductor})}</p>
          {conflict.endpoints.map(endpoint => <button type="button" className="quiet" key={circuitEndpointKey(endpoint)}
            disabled={!isBoardRouteTerminalCompatible(data,boardId,conflict.conductor,endpoint)}
            onClick={() => onChange(assignCircuitBoardTerminal(data,circuit.id,boardId,conflict.conductor,endpoint))}>{wiringEndpointLabel(data,endpoint)}</button>)}
        </div>)}
      </div>)}
    </div>
  </details>;
}
