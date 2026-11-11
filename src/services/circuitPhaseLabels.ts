import { getCircuitPhaseConnections } from '../data/circuitPhaseConnections';
import { wiringEndpointLabel } from '../data/boardWiring';
import { t } from '../i18n';
import type { Circuit, ProjectData } from '../types';

/** Format actual phase terminals, including any unresolved legacy alternatives. */
export function circuitPhaseConnectionLabel(data:ProjectData, circuit:Circuit, boardId?:string):string {
  const connections = getCircuitPhaseConnections(data,circuit).filter(item => !boardId || item.boardId === boardId);
  if (!connections.length) return t('Nincs fázisbekötés');
  return connections.map(item => {
    const board = data.boards.length > 1 ? data.boards.find(value => value.id === item.boardId)?.name : undefined;
    const endpoint = item.kind === 'connected'
      ? wiringEndpointLabel(data,item.endpoint)
      : `${t('Ellenőrizendő')}: ${item.conflictingEndpoints.map(value => wiringEndpointLabel(data,value)).join(' / ')}`;
    return [board,`${item.conductor} · ${endpoint}`].filter(Boolean).join(' · ');
  }).join('; ');
}
