import { t } from '../i18n';
import { wiringEndpointLabel } from '../data/boardWiring';
import { getCircuitPhaseConnections } from '../data/circuitPhaseConnections';
import { isCircuitProtectionDevice } from '../data/floorRouteProtection';
import type { Circuit, ProjectData } from '../types';
import './circuit-phase-connections.css';

/** Read-only: electrical phase connections are edited on the cabinet drawing. */
export function CircuitPhaseConnectionDisplay({data,circuit}:{data:ProjectData; circuit:Circuit}) {
  const connections = getCircuitPhaseConnections(data,circuit);
  return <div className="circuit-phase-connection">
    <span>{t('Védelmi készülék')}</span>
    <div className="circuit-phase-connection-value" aria-label={t('{code} védelme', {code:circuit.code})}>
      {!connections.length && <span>{t('Nincs fázisbekötés az elosztón.')}</span>}
      {connections.map((connection,index) => {
        const boardName = data.boards.find(board => board.id === connection.boardId)?.name ?? '';
        if (connection.kind === 'unresolved') return <div key={index}>
          <strong>{connection.conductor}{data.boards.length > 1 && boardName ? ` · ${boardName}` : ''}</strong>
          {' · '}{t('Korábbi fázisbekötés tisztázandó az elosztón.')}
        </div>;
        const connectionEndpoint = connection.endpoint;
        const device = connectionEndpoint.kind === 'device'
          ? data.devices.find(item => item.id === connectionEndpoint.deviceId) : undefined;
        const endpoint = wiringEndpointLabel(data,connection.endpoint);
        return <div key={index}>
          <strong>{connection.conductor}{data.boards.length > 1 && boardName ? ` · ${boardName}` : ''}</strong>
          {' · '}{endpoint}{device ? ` · ${device.name}` : ''}
          {(!device || (!isCircuitProtectionDevice(device) && device.electrical?.role !== 'mpcb')) && <small>{t('A túláramvédelmi készülék ebből a közvetlen bekötésből nem állapítható meg.')}</small>}
        </div>;
      })}
    </div>
    <small>{t('Az elosztórajzon megadott fázisbekötés alapján.')}</small>
  </div>;
}
