import { useEffect, useRef } from 'react';
import { Trash2, Zap, ArrowUpRight } from 'lucide-react';
import { getLocale, t } from '../i18n';
import type { ProjectData } from '../types';
import { CircuitPhaseConnectionDisplay } from './CircuitPhaseConnectionDisplay';
import { CircuitBoardVisibility } from './CircuitBoardVisibility';
import { CircuitConductors } from './CircuitConductors';
import { deleteCircuit } from '../data/circuitBoard';
import './circuits-scroll.css';

interface Props {
  data: ProjectData;
  onChange: (data: ProjectData) => void;
  onSelect: (id: string) => void;
  newCircuitId?: string;
  onNewCircuitFocused: () => void;
}

const CROSS_SECTIONS = [1.5, 2.5, 4, 6];

export function Circuits({ data, onChange, onSelect, newCircuitId, onNewCircuitFocused }: Props) {
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!newCircuitId) return;
    const card = Array.from(cardsRef.current?.querySelectorAll<HTMLElement>('[data-circuit-id]') ?? [])
      .find(item => item.dataset.circuitId === newCircuitId);
    const field = card?.querySelector<HTMLInputElement>('[data-circuit-name]');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (field) onNewCircuitFocused();
  }, [newCircuitId, onNewCircuitFocused]);

  const patch = (id: string, values: object) => onChange({
    ...data,
    circuits: data.circuits.map(c => c.id === id ? { ...c, ...values } : c),
  });

  return <div className="circuits-view">
    <div className="section-heading"><div><span className="eyebrow">{t('KÖZÖS PROJEKTADATOK')}</span><h2>{t('Áramkörök')}</h2><p>{t('Az alaprajz és az elosztó közötti kapcsolat.')}</p></div></div>
    {!data.circuits.length && <div className="empty"><Zap size={36}/><h3>{t('Még nincs áramkör')}</h3><p>{t('Hozz létre egyet, majd rendelj hozzá eszközöket.')}</p></div>}
    <div className="circuit-cards" ref={cardsRef} role="region" aria-label={t('Áramkörök')} tabIndex={0}>
      {data.circuits.map(c => {
        const devices = data.devices.filter(d => d.circuitId === c.id);
        const crossSection = c.cableDetails?.crossSectionMm2;
        const crossSections = crossSection !== undefined && !CROSS_SECTIONS.includes(crossSection)
          ? [...CROSS_SECTIONS, crossSection].sort((a, b) => a - b)
          : CROSS_SECTIONS;
        return <article className="circuit-card" data-circuit-id={c.id} key={c.id} style={{ '--circuit-color': c.color } as React.CSSProperties}>
          <div className="circuit-header">
            <input aria-label={t('{code} színe', { code: c.code })} type="color" value={c.color} onChange={e => patch(c.id, { color: e.target.value })}/>
            <input className="circuit-code" aria-label={t('{code} azonosítója', { code: c.code })} value={c.code} onChange={e => patch(c.id, { code: e.target.value })}/>
            <span className="small-tag">{t('{count} eszköz', { count: devices.length })}</span>
            <button className="icon-button danger-hover" aria-label={t('{code} törlése', { code: c.code })} onClick={() => {
              if (!confirm(t('Törlöd az áramkört? Az eszközök megmaradnak, a hozzárendelésük megszűnik.'))) return;
              onChange(deleteCircuit(data, c.id));
            }}><Trash2 size={16}/></button>
          </div>
          <label>{t('Áramkör neve')}<input data-circuit-name aria-label={t('{code} neve', { code: c.code })} value={c.name} onChange={e => patch(c.id, { name: e.target.value })}/></label>
          <CircuitPhaseConnectionDisplay data={data} circuit={c}/>
          <CircuitBoardVisibility data={data} circuit={c} onChange={onChange}/>
          <CircuitConductors data={data} circuit={c} onChange={onChange}/>
          <label>{t('Keresztmetszet (mm²)')}
            <select aria-label={`${c.code}: ${t('Keresztmetszet (mm²)')}`} value={crossSection ?? ''} onChange={e => {
              const value = e.target.value;
              patch(c.id, { cableDetails: { ...c.cableDetails, crossSectionMm2: value === '' ? undefined : Number(value) } });
            }}>
              <option value="">{t('Nincs megadva')}</option>
              {crossSections.map(value => <option key={value} value={value}>{value.toLocaleString(getLocale())} mm²</option>)}
            </select>
          </label>
          <label>{t('Kábel / vezeték megnevezése')}<input aria-label={t('{code} kábele', { code: c.code })} value={c.cable ?? ''} maxLength={5000} placeholder={t('Például: H07V-U vagy NYM-J')} onChange={e => patch(c.id, { cable: e.target.value })}/></label>
          <label>{t('Rögzített teljesítmény (W)')}<input aria-label={t('{code} teljesítménye', { code: c.code })} type="number" min="0" max="1000000000" step="any" value={c.powerW ?? ''} onChange={e => {
            const value = e.target.value;
            if (value === '') patch(c.id, { powerW: undefined });
            else { const n = Number(value); if (Number.isFinite(n) && n >= 0 && n <= 1000000000) patch(c.id, { powerW: n }); }
          }}/></label>
          <p className="subtle">{t('A kábel és a teljesítmény kézzel rögzített adat; a program nem méretez belőlük.')}</p>
          <label>{t('Megjegyzés')}<textarea aria-label={t('{code} megjegyzése', { code: c.code })} rows={2} value={c.notes} onChange={e => patch(c.id, { notes: e.target.value })}/></label>
          <div className="circuit-device-list">
            {devices.map(d => <button key={d.id} onClick={() => onSelect(d.id)}><span>{d.code}</span>{d.name}<ArrowUpRight size={13}/></button>)}
            {!devices.length && <p className="subtle">{t('Az eszköz adatlapján választható ki ez az áramkör.')}</p>}
          </div>
        </article>;
      })}
    </div>
  </div>;
}
