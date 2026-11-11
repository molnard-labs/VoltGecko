import { t } from '../i18n';
import { adoptCircuitProtection, type CircuitProtectionStatus } from '../data/floorRouteProtection';
import type { ProjectData } from '../types';

/** Explicitly resolve conflicting protection candidates without losing a manual selection. */
export function ProtectionConflict({ data, status, onChange }: {
  data: ProjectData; status?: CircuitProtectionStatus; onChange: (data: ProjectData) => void;
}) {
  if (!status || (status.kind !== 'conflict' && status.kind !== 'ambiguous')) return null;
  const circuit = data.circuits.find(item => item.id === status.circuitId);
  const current = data.devices.find(item => item.id === status.currentDeviceId);
  const candidates = status.candidateDeviceIds.flatMap(id => {
    const device = data.devices.find(item => item.id === id);
    return device ? [device] : [];
  });
  return <div className="input-warning" role="alert">
    <p>{status.kind === 'ambiguous'
      ? t('A(z) {circuit} áramkörhöz több védelmi készülék kapcsolódik. Válaszd ki a megfelelőt.', { circuit:circuit?.code ?? '' })
      : t('A(z) {circuit} áramkörhöz másik védelmi készülék van megadva: {device}.', { circuit:circuit?.code ?? '', device:current?.code ?? '—' })}</p>
    {candidates.map(device => <button type="button" className="quiet" key={device.id}
      onClick={() => onChange(adoptCircuitProtection(data, status.circuitId, device.id))}>
      {t('Védelmi készülék: {device}', { device:`${device.code} · ${device.name}` })}
    </button>)}
  </div>;
}
