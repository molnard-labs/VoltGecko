import { Cable, Trash2 } from 'lucide-react';
import { t } from '../i18n';
import type { Board, ProjectData } from '../types';

interface Props { data: ProjectData; board: Board; onChange: (data: ProjectData) => void; onNotify: (message: string) => void; onSelect: (id: string) => void }

/** Preserve old device-level links until the user replaces them with terminal wiring. */
export function BoardConnections({ data, board, onChange, onSelect }: Props) {
  const links = board.connections ?? [];
  const devices = new Map(data.devices.map(device => [device.id, device]));
  const remove = (id: string) => onChange({ ...data, boards: data.boards.map(item => item.id === board.id
    ? { ...item, connections: links.filter(link => link.id !== id) } : item) });
  return <section className="board-connections">
    <h3><Cable size={17}/>{t('Betáplálás és korábbi kapcsolatok')}</h3>
    <label className="supply-label">{t('Betáplálás megnevezése')}<input value={board.supplyLabel ?? ''} maxLength={5000} placeholder={t('Például: 3×400/230 V, lakásbetáp')} onChange={event => onChange({ ...data, boards: data.boards.map(item => item.id === board.id ? { ...item, supplyLabel: event.target.value } : item) })}/></label>
    {links.length > 0 && <>
      <p className="subtle">{t('A korábbi tervben készülékszinten megadott kapcsolatok megmaradtak. Kapocsadataik nincsenek: a részletes hálózatot fent, vezetékekkel szerkeszd. A lecserélt régi kapcsolatot itt törölheted.')}</p>
      <div className="board-link-list">{links.map(link => {
        const from = link.fromDeviceId ? devices.get(link.fromDeviceId)?.code ?? '?' : t('Külső betáplálás');
        const target = devices.get(link.toDeviceId);
        const to = target?.code ?? '?';
        return <div key={link.id}><span>{from} → {target ? <button className="quiet" onClick={() => onSelect(target.id)}>{to}</button> : to}</span><button className="icon-button danger-hover" aria-label={t('Kapcsolat törlése: {from} → {to}', { from, to })} onClick={() => remove(link.id)}><Trash2 size={14}/></button></div>;
      })}</div>
    </>}
  </section>;
}
