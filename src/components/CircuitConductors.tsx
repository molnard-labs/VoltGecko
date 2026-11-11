import { t } from '../i18n';
import { availableCircuitConductors, conductorOrder, confirmCircuitConductors, includeRecordedCircuitConductors, recordedCircuitConductors, selectedCircuitConductors, setCircuitConductor } from '../data/circuitConductors';
import type { Circuit, ProjectData } from '../types';

/** The declared conductors describe the circuit; checking one does not connect it. */
export function CircuitConductors({data,circuit,onChange}:{data:ProjectData;circuit:Circuit;onChange:(data:ProjectData)=>void}) {
  const available = availableCircuitConductors(data,circuit);
  const selected = selectedCircuitConductors(circuit);
  const connected = recordedCircuitConductors(circuit);
  const options = conductorOrder.filter(item => available.includes(item) || selected.includes(item));
  const unavailable = selected.filter(item => !available.includes(item));
  const unlisted = circuit.conductors === undefined ? [] : connected.filter(item => !circuit.conductors!.includes(item));
  return <fieldset className="circuit-conductors">
    <legend>{t('Áramköri vezetők')}</legend>
    {options.length > 0 && <div className="circuit-conductor-options">{options.map(conductor => {
      const locked = connected.includes(conductor);
      return <label className="circuit-conductor-option" key={conductor}>
        <input type="checkbox" checked={selected.includes(conductor)} disabled={locked || unlisted.length > 0}
          aria-label={t('{code}: {conductor} vezető', {code:circuit.code,conductor})}
          onChange={event=>onChange(setCircuitConductor(data,circuit.id,conductor,event.target.checked))}/>
        <span>{conductor}</span>
      </label>;
    })}</div>}
    <p className="circuit-conductor-hint">{t('Kijelölve: {count} vezető', {count:selected.length})}</p>
    {circuit.conductors === undefined && <div className="circuit-conductor-hint">
      <p>{t('Korábbi áramkör: a meglévő fázist és bekötéseket mutatjuk. Ellenőrizd a vezetőket.')}</p>
      {selected.length > 0 && <button type="button" onClick={()=>onChange(confirmCircuitConductors(data,circuit.id))}>{t('Vezetők megerősítése')}</button>}
    </div>}
    {!available.length && <p className="circuit-conductor-hint">{t('Előbb add meg az elosztó betáplálásának vezetőit.')}</p>}
    {connected.length > 0 && <p className="circuit-conductor-hint">{t('A bekötött vezetőt előbb válaszd le az elosztón: {conductors}.', {conductors:connected.join(', ')})}</p>}
    {unavailable.length > 0 && <p className="circuit-conductor-hint">{t('A betáplálásban jelenleg nem szerepel: {conductors}.', {conductors:unavailable.join(', ')})}</p>}
    {unlisted.length > 0 && <div className="circuit-conductor-hint">
      <p>{t('A már bekötött vezető nincs a mentett kijelölésben: {conductors}.', {conductors:unlisted.join(', ')})}</p>
      <button type="button" onClick={()=>onChange(includeRecordedCircuitConductors(data,circuit.id))}>{t('Bekötött vezetők hozzáadása a kijelöléshez')}</button>
    </div>}
  </fieldset>;
}
