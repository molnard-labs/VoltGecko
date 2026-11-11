import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import { assignCircuitBoardTerminal, getCircuitBoardConnections } from '../data/circuitBoard';
import { isBoardRouteTerminalCompatible } from '../data/boardRouteConnections';
import { projectPhases } from '../data/projectPhases';
import { wiringEndpointLabel } from '../data/boardWiring';
import type { Board, Circuit, CircuitBoardConnection, Conductor, ProjectData, WiringEndpoint } from '../types';
import { encodeEndpoint, getEndpointOptions, parseEndpoint } from './board-wiring/endpoints';
import './board-circuit-panel.css';

interface Props { data:ProjectData; board:Board; onChange:(data:ProjectData)=>void }

function CircuitTerminals({ data, board, circuit, connection, onChange }: Props & {circuit:Circuit; connection:CircuitBoardConnection}) {
  const [conductor,setConductor] = useState<Conductor>('L');
  const [value,setValue] = useState('');
  const used = new Set(connection.terminals.map(item => item.conductor));
  const candidates:Conductor[] = [...projectPhases(data),'N','PE','PEN'];
  const available = candidates.filter(item => !used.has(item));
  const selected = available.includes(conductor) ? conductor : available[0];
  const options = getEndpointOptions(data).filter(item => item.group === board.id);
  const matching = (wire:Conductor) => options.filter(item => isBoardRouteTerminalCompatible(data,board.id,wire,item.value));
  const assign = (wire:Conductor,endpoint?:WiringEndpoint) => onChange(assignCircuitBoardTerminal(data,circuit.id,board.id,wire,endpoint));
  const canAdd = !!selected && !!value && matching(selected).some(option => encodeEndpoint(option.value) === value);
  return <details className="board-circuit-item" data-testid="board-circuit-item">
    <summary><strong>{circuit.code} · {circuit.name}</strong><span>{t('{count} vezető', {count:connection.terminals.length})}</span></summary>
    {!connection.terminals.length && <p className="subtle">{t('Még nincs kapocshoz rendelt vezető.')}</p>}
    {connection.terminals.map(item => {
      const selectedValue=encodeEndpoint(item.endpoint), valid=matching(item.conductor).some(option=>encodeEndpoint(option.value)===selectedValue);
      return <div className="board-circuit-terminal" key={item.conductor}>
        <label>{item.conductor}<select aria-label={t('{circuit}: {conductor} kapcsa',{circuit:circuit.code,conductor:item.conductor})} value={selectedValue} onChange={event=>assign(item.conductor,parseEndpoint(event.target.value))}>
          {!valid && <option value={selectedValue}>{wiringEndpointLabel(data,item.endpoint)} · {t('Ellenőrizd a kapcsot')}</option>}
          {matching(item.conductor).map(option=><option key={encodeEndpoint(option.value)} value={encodeEndpoint(option.value)}>{option.text}</option>)}
        </select></label>
        <button type="button" className="icon-button danger-hover" aria-label={t('{circuit}: {conductor} hozzárendelés törlése',{circuit:circuit.code,conductor:item.conductor})} title={t('Hozzárendelés törlése')} onClick={()=>assign(item.conductor)}><Trash2 size={16}/></button>
        {!valid && <p className="input-warning" role="alert">{t('Ez a kapocs már nem érhető el vagy a vezető típusa megváltozott.')}</p>}
      </div>;
    })}
    {!!available.length && <div className="board-circuit-add">
      <label>{t('Vezető')}<select aria-label={t('{circuit}: új vezető',{circuit:circuit.code})} value={selected ?? ''} onChange={event=>{setConductor(event.target.value as Conductor);setValue('');}}>{available.map(item=><option key={item}>{item}</option>)}</select></label>
      <label>{t('Elosztó kapcsa')}<select aria-label={t('{circuit}: új vezető kapcsa',{circuit:circuit.code})} value={canAdd?value:''} onChange={event=>setValue(event.target.value)}><option value="">{t('Csatlakozópont kiválasztása')}</option>{matching(selected).map(option=><option key={encodeEndpoint(option.value)} value={encodeEndpoint(option.value)}>{option.text}</option>)}</select></label>
      <button type="button" className="quiet" disabled={!canAdd} onClick={()=>{assign(selected,parseEndpoint(value));setValue('');}}><Plus size={15}/>{t('Vezető hozzárendelése')}</button>
    </div>}
    {selected && !matching(selected).length && <p className="subtle">{t('Nincs az elosztóban ehhez a vezetőhöz illő kapocs.')}</p>}
  </details>;
}

export function BoardCircuitPanel({data,board,onChange}:Props) {
  const circuits = getCircuitBoardConnections(data,board.id);
  return <section className="board-circuit-panel" aria-label={t('Áramkörök kapcsai')}>
    <h4>{t('Áramkörök kapcsai')}</h4>
    {!circuits.length && <p className="subtle">{t('Ehhez az elosztóhoz még nincs áramkör hozzárendelve.')}</p>}
    {circuits.map(({circuit,connection})=><CircuitTerminals key={circuit.id} data={data} board={board} circuit={circuit} connection={connection} onChange={onChange}/>)}
  </section>;
}
