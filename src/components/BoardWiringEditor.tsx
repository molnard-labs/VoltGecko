import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Cable, Plus } from 'lucide-react';
import { t, getLocale } from '../i18n';
import { uid, makeDevice } from '../catalog';
import { placeBoardDevice } from '../data/boardPlacement';
import { defaultWireColor } from '../data/wireColors';
import {
  assignConnectedPhase,
  endpointConductor,
  getWiringIssues,
  getPhaseLoads,
  balanceUnassignedPhases
} from '../data/boardWiring';
import type { Board, BoardBus, BoardInfeed, BoardWire, BoardWiring, ProjectData, WiringEndpoint } from '../types';
import {
  encodeEndpoint,
  getEndpointOptions,
  parseEndpoint,
  sameEndpoint
} from './board-wiring/endpoints';
import { WiringDiagram, useWiringDiagram } from './board-wiring/WiringDiagram';
import { EndpointSelect, WirePanel } from './board-wiring/WirePanel';
import type { WireEstimate } from './board-wiring/WirePanel';
import { SourcesPanel } from './board-wiring/SourcesPanel';

interface Props {
  data: ProjectData;
  board: Board;
  selectedId: string | null;
  onChange: (data: ProjectData) => void;
  onNotify: (message: string) => void;
  onSelect: (id: string | null) => void;
  onPlaceDevice: (deviceId: string, rowId: string, start: number) => void;
}
const EMPTY: BoardWiring = { buses: [], wires: [], infeeds: [] };

export function BoardWiringEditor({ data, board, selectedId, onChange, onNotify, onSelect, onPlaceDevice }: Props) {
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [continuousWiring, setContinuousWiring] = useState(false);
  const [wireId, setWireId] = useState<string>();
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<WireEstimate>();
  const wiring = board.wiring ?? EMPTY;
  const locale = getLocale();
  const issues = useMemo(() => getWiringIssues(data, board), [data, board, locale]);
  const loads = useMemo(() => getPhaseLoads(data, board), [data, board]);
  useEffect(() => {
    if (selectedId) setWireId(undefined);
  }, [selectedId]);
  const selectDevice = (id: string | null) => {
    setWireId(undefined);
    onSelect(id);
  };
  const selectWire = (id: string) => {
    onSelect(null);
    setWireId(id);
  };
  const update = (fn: (value: BoardWiring, data: ProjectData) => void) => {
    const next = structuredClone(data),
      target = next.boards.find((b) => b.id === board.id)!;
    target.wiring ??= structuredClone(EMPTY);
    fn(target.wiring, next);
    onChange(next);
  };
  const patchWire = (id: string, patch: Partial<BoardWire>) =>
    update((value) => {
      const wire = value.wires.find((w) => w.id === id);
      if (wire) Object.assign(wire, patch);
    });
  const patchBus = (id: string, patch: Partial<BoardBus>) =>
    update((value) => {
      const bus = value.buses.find((b) => b.id === id);
      if (bus) Object.assign(bus, patch);
    });
  const patchInfeed = (id: string, patch: Partial<BoardInfeed>) =>
    update((value) => {
      const source = value.infeeds.find((s) => s.id === id);
      if (source) Object.assign(source, patch);
    });
  const selectEndpoint = (endpoint: WiringEndpoint) => {
    onSelect(null);
    setError('');
    if (!fromValue || (toValue && !continuousWiring)) {
      setFromValue(encodeEndpoint(endpoint));
      setToValue('');
    } else setToValue(encodeEndpoint(endpoint));
  };
  const from = parseEndpoint(fromValue),
    to = parseEndpoint(toValue);
  const notifyError = (message: string) => {
    setError(message);
    onNotify(message);
  };
  const addPreset = (role: 'terminal' | 'mpcb' | 'meter') => {
    const next = structuredClone(data),
      device = makeDevice('custom', next.devices),
      prefix = role === 'terminal' ? 'XT' : role === 'mpcb' ? 'QM' : 'EM';
    let number = 1;
    while (next.devices.some((item) => item.code === `${prefix}${number}`)) number++;
    device.code = `${prefix}${number}`;
    device.name = t(role === 'terminal' ? 'Sorkapocs' : role === 'mpcb' ? 'Motorvédő' : 'Fogyasztásmérő');
    device.moduleWidth = role === 'terminal' ? 29 / 18 : role === 'mpcb' ? 3 : 4;
    device.electrical =
      role === 'terminal'
        ? { role, poles: ['L1', 'L1'] }
        : { role, poles: role === 'meter' ? ['L1', 'L2', 'L3', 'N'] : ['L1', 'L2', 'L3'] };
    next.devices.push(device);
    const target = next.boards.find((item) => item.id === board.id)!;
    if (!target.rows.length)
      target.rows.push({ id: uid(), name: t('{number}. sor', { number: 1 }), capacity: 12, placements: [] });
    onChange(placeBoardDevice(next, target.id, target.rows[0].id, device.id));
    selectDevice(device.id);
  };
  const addWire = () => {
    if (!from || !to) return;
    if (!endpointConductor(data, from) || !endpointConductor(data, to)) {
      setError(t('A kiválasztott csatlakozópont megváltozott. Válaszd ki újra a két végpontot.'));
      return;
    }
    if (sameEndpoint(from, to)) {
      setError(t('Két különböző csatlakozópontot válassz.'));
      return;
    }
    if (
      wiring.wires.some(
        (w) =>
          (sameEndpoint(w.from, from) && sameEndpoint(w.to, to)) ||
          (sameEndpoint(w.to, from) && sameEndpoint(w.from, to))
      )
    ) {
      setError(t('Ez a vezeték már szerepel a tervben.'));
      return;
    }
    const id = uid();
    update((value, next) => {
      assignConnectedPhase(next, from, to);
      const conductor = endpointConductor(next, from);
      value.wires.push({ id, from, to, ...defaultWireColor(conductor) });
    });
    selectWire(id);
    if (!continuousWiring) setFromValue('');
    setToValue('');
    setError('');
  };
  const endpoints = useMemo(() => getEndpointOptions(data), [data, locale]);
  const clearError = () => setError('');
  const endpointSelect = (value: string, onChange: (value: string) => void, title: string) => (
    <EndpointSelect
      data={data}
      endpoints={endpoints}
      value={value}
      title={title}
      onChange={(value) => {
        onChange(value);
        clearError();
      }}
    />
  );
  const diagram = useWiringDiagram(data, board, wiring, { patchWire, patchBus, patchInfeed, placeDevice: onPlaceDevice });
  const selectedWire = wiring.wires.find((wire) => wire.id === wireId);
  const selectedRoute = selectedWire ? diagram.route(selectedWire, wiring.wires.indexOf(selectedWire)) : [];

  return (
    <section className="board-wiring board-wiring-unified" data-testid="board-wiring">
      <div className="wiring-heading">
        <Cable size={19} />
        <span>{t('Elosztó és huzalozás')}</span>
        <span className="small-tag">
          {wiring.wires.length} {t('vezeték')}
        </span>
      </div>
        <div className="wiring-content">
          <div className="row-actions wiring-presets">
            <button className="quiet" onClick={() => addPreset('terminal')}>
              <Plus size={14} />
              {t('Sorkapocs hozzáadása')}
            </button>
            <button className="quiet" onClick={() => addPreset('mpcb')}>
              <Plus size={14} />
              {t('Motorvédő hozzáadása')}
            </button>
            <button className="quiet" onClick={() => addPreset('meter')}>
              <Plus size={14} />
              {t('Fogyasztásmérő hozzáadása')}
            </button>
          </div>
          <p className="subtle">
            {t('A készülékeket a fogantyújukkal mozgasd. A kapcsokra kattintva vezetékeket hozhatsz létre.')}
          </p>
          <WiringDiagram
            data={data}
            board={board}
            wiring={wiring}
            diagram={diagram}
            from={from}
            to={to}
            selectedDeviceId={selectedId}
            selectedWireId={wireId}
            onSelectWire={selectWire}
            onSelectDevice={selectDevice}
            onSelectEndpoint={selectEndpoint}
            onPlaceDevice={onPlaceDevice}
          />
          <p className="subtle">
            {t(
              'Válassz két konkrét csatlakozópontot a rajzon vagy a listákban, majd hozd létre a vezetéket. A kattintási sorrend szabad.'
            )}
          </p>
          <div className="row-actions">
            <button
              className="quiet wiring-mode-toggle"
              aria-pressed={continuousWiring}
              onClick={() => {
                setContinuousWiring((value) => !value);
                setError('');
              }}
            >
              {t('Folyamatos bekötés')}
            </button>
            {continuousWiring && (
              <span className="subtle">
                {t('A kezdőpont megmarad a vezeték létrehozása után. Válassz új végpontot a következő bekötéshez.')}
              </span>
            )}
          </div>
          <div className="wiring-connect-form">
            {endpointSelect(fromValue, setFromValue, t('Vezeték kezdőpontja'))}
            {endpointSelect(toValue, setToValue, t('Vezeték végpontja'))}
            <button className="primary" disabled={!from || !to} onClick={addWire}>
              <Plus size={15} />
              {t('Vezeték létrehozása')}
            </button>
            <button
              className="quiet"
              onClick={() => {
                setFromValue('');
                setToValue('');
                setError('');
              }}
            >
              {t('Kijelölés törlése')}
            </button>
          </div>
          {error && (
            <p role="alert" className="input-warning">
              {error}
            </p>
          )}
          <p className="subtle">
            {t(
              'A kijelölt vezeték csomópontjai és felirata húzhatók. Az alábbi mezőkkel billentyűzettel is szerkeszthetők.'
            )}
          </p>
          <div className="wiring-panels">
            <WirePanel
              data={data}
              wires={wiring.wires}
              selectedWireId={wireId}
              selectedRoute={selectedRoute}
              endpoints={endpoints}
              onSelectWire={selectWire}
              onPatchWire={patchWire}
              onDeleteWire={(id) => {
                update((value) => {
                  value.wires = value.wires.filter((wire) => wire.id !== id);
                });
                setWireId(undefined);
              }}
              onClearError={clearError}
              estimate={estimate}
              onEstimateChange={setEstimate}
            />
            <SourcesPanel
              data={data}
              board={board}
              wiring={wiring}
              busOrigin={diagram.busOrigin}
              sourceOrigin={diagram.sourceOrigin}
              onUpdate={update}
              onPatchBus={patchBus}
              onPatchInfeed={patchInfeed}
              onNotify={onNotify}
              onError={notifyError}
              onClearError={clearError}
            />
          </div>
          <div className="wiring-phase">
            <h4>{t('Tervezett fázisterhelés')}</h4>
            <label>
              {t('Egyidejűségi tényező (0–1)')}
              <input
                aria-label={t('Egyidejűségi tényező (0–1)')}
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={wiring.demandFactor ?? 1}
                onChange={(e) => {
                  const demandFactor = Number(e.target.value);
                  if (Number.isFinite(demandFactor) && demandFactor >= 0 && demandFactor <= 1)
                    update((value) => {
                      value.demandFactor = demandFactor;
                    });
                }}
              />
            </label>
            <p>
              {t('Összesen: {total} W · egyidejű becslés: {demand} W', {
                total: loads.totalW.toLocaleString(getLocale(), { maximumFractionDigits: 0 }),
                demand: (loads.totalW * (wiring.demandFactor ?? 1)).toLocaleString(getLocale(), {
                  maximumFractionDigits: 0
                })
              })}
            </p>
            <div>
              {(['L1', 'L2', 'L3'] as const).map((phase) => (
                <span key={phase}>
                  {phase} <strong>{loads[phase].toLocaleString(getLocale(), { maximumFractionDigits: 0 })} W</strong>
                </span>
              ))}
              <span>
                {t('Nincs kiosztva')}{' '}
                <strong>{loads.unassignedW.toLocaleString(getLocale(), { maximumFractionDigits: 0 })} W</strong>
              </span>
            </div>
            <button className="quiet" onClick={() => onChange(balanceUnassignedPhases(data, board))}>
              {t('Kiosztatlan fázisok kiegyensúlyozása')}
            </button>
            <p className="subtle">
              {t('Csak a még ki nem osztott áramkörök fázisát módosítja. A teljesítményadatokból számolt becslés.')}
            </p>
          </div>
          {issues.length > 0 && (
            <div className="validation-box">
              <h3>
                <AlertTriangle size={16} />
                {t('Huzalozási jelzések')}
              </h3>
              {issues.map((issue, index) => (
                <p key={index} className={issue.severity === 'error' ? 'danger-text' : ''}>
                  {issue.message}
                </p>
              ))}
            </div>
          )}
        </div>
    </section>
  );
}
