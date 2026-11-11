import { t } from '../i18n';
import { setCircuitBoardsVisible } from '../data/circuitBoard';
import type { Circuit, ProjectData } from '../types';
import './circuit-board-visibility.css';

/** This switch affects drawing visibility only, never electrical connections. */
export function CircuitBoardVisibility({data,circuit,onChange}: {
  data:ProjectData; circuit:Circuit; onChange:(data:ProjectData)=>void;
}) {
  const hiddenBoards = data.boards.filter(board => circuit.boardConnections?.some(connection => connection.boardId === board.id && connection.hidden));
  return <div>
  <label className="circuit-board-visibility">
    <input type="checkbox" role="switch" aria-label={t('{code}: Megjelenítés az elosztó felületén', {code:circuit.code})}
      checked={!circuit.hideOnBoards} onChange={event => onChange(setCircuitBoardsVisible(data,circuit.id,event.target.checked))}/>
    <span>{t('Megjelenítés az elosztó felületén')}</span>
  </label>
  {!circuit.hideOnBoards && hiddenBoards.length > 0 && <p className="subtle circuit-board-local-hidden">
    {t('Ezeken az elosztókon külön rejtett: {boards}', {boards:hiddenBoards.map(board => board.name).join(', ')})}
  </p>}
  </div>;
}
