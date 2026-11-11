import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Cable, Grid3X3, Plus, Trash2 } from 'lucide-react';
import { t, getLocale } from '../i18n';
import { uid } from '../catalog';
import { defaultWireColor } from '../data/wireColors';
import { loadPhases } from '../data/projectPhases';
import { isBoardRouteTerminalCompatible } from '../data/boardRouteConnections';
import { assignCircuitBoardTerminal, setCircuitBoardPosition } from '../data/circuitBoard';
import {
  assignConnectedPhase,
  endpointConductor,
  getWiringIssues,
  getPhaseLoads,
  balanceUnassignedPhases
} from '../data/boardWiring';
import type { Board, BoardBus, BoardInfeed, BoardWire, BoardWiring, Conductor, Point, ProjectData, WiringEndpoint } from '../types';
import {
  encodeEndpoint,
  getEndpointOptions,
  parseEndpoint,
  wireEndpointError
} from './board-wiring/endpoints';
import { WiringDiagram, useWiringDiagram } from './board-wiring/WiringDiagram';
import { EndpointSelect, WirePanel } from './board-wiring/WirePanel';
import type { WireEstimate } from './board-wiring/WirePanel';
import { SourcesPanel } from './board-wiring/SourcesPanel';
import { BoardCircuitPanel } from './BoardCircuitPanel';
import { insertWireBend } from './board-wiring/wireEditing';
import './board-wiring/wire-toolbar.css';

interface Props {
  data: ProjectData;
  board: Board;
  selectedId: string | null;
  onChange: (data: ProjectData) => void;
  onNotify: (message: string) => void;
  onSelect: (id: string | null) => void;
  onPlaceDevice: (deviceId: string, rowId: string, start: number) => void;
  actionHost?: HTMLElement | null;
}
const EMPTY: BoardWiring = { buses: [], wires: [], infeeds: [] };

export function BoardWiringEditor({ data, board, selectedId, onChange, onNotify, onSelect, onPlaceDevice, actionHost }: Props) {
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [continuousWiring, setContinuousWiring] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [wireId, setWireId] = useState<string>();
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<WireEstimate>();
  const [circuitConnector, setCircuitConnector] = useState<{ circuitId: string; conductor: Conductor }>();
  const wiring = board.wiring ?? EMPTY;
  const locale = getLocale();
  const issues = useMemo(() => getWiringIssues(data, board), [data, board, locale]);
  const loads = useMemo(() => getPhaseLoads(data, board), [data, board]);
  useEffect(() => {
    if (selectedId) setWireId(undefined);
  }, [selectedId]);
  useEffect(() => { setCircuitConnector(undefined); }, [board.id]);
  useEffect(() => {
    if (!circuitConnector) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setCircuitConnector(undefined); setError(''); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [circuitConnector]);
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
  const patchWire = (id: string, patch: Partial<BoardWire>) => {
    const original = wiring.wires.find((wire) => wire.id === id);
    if (!original) return;
    const from = patch.from ?? original.from, to = patch.to ?? original.to;
    if (patch.from || patch.to) {
      const message = wireEndpointError(data, wiring.wires, from, to, id);
      if (message) { setError(message); onNotify(message); return; }
      setError('');
    }
    update((value) => {
      const wire = value.wires.find((w) => w.id === id);
      if (wire) Object.assign(wire, patch);
    });
  };
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
  const connectCircuitEndpoint = (selection: { circuitId: string; conductor: Conductor }, endpoint: WiringEndpoint) => {
    if (!isBoardRouteTerminalCompatible(data, board.id, selection.conductor, endpoint)) {
      const message = t('Ez a kapocs nem ehhez az elosztóhoz vagy vezetőhöz tartozik. Válassz megfelelő kapcsot.');
      setError(message); onNotify(message); return false;
    }
    const next = assignCircuitBoardTerminal(data, selection.circuitId, board.id, selection.conductor, endpoint);
    if (next === data) {
      const message = t('Az áramkör vagy a kapocs megváltozott. Válaszd ki újra a végpontokat.');
      setError(message); onNotify(message); return false;
    }
    onChange(next); setCircuitConnector(undefined); setFromValue(''); setToValue(''); setError('');
    onNotify(t('Az áramkör vezetője a kiválasztott kapocshoz került.'));
    return true;
  };
  const selectCircuitConnector = (circuitId: string, conductor: Conductor) => {
    const selection = { circuitId, conductor };
    if (circuitConnector?.circuitId === circuitId && circuitConnector.conductor === conductor) {
      setCircuitConnector(undefined); setError(''); return;
    }
    const first = !toValue ? parseEndpoint(fromValue) : undefined;
    setWireId(undefined); onSelect(null); setError('');
    if (first && connectCircuitEndpoint(selection, first)) return;
    setFromValue(''); setToValue(''); setCircuitConnector(selection);
  };
  const selectEndpoint = (endpoint: WiringEndpoint) => {
    onSelect(null);
    setError('');
    if (circuitConnector) { connectCircuitEndpoint(circuitConnector, endpoint); return; }
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
  const addWire = () => {
    if (!from || !to) return;
    const message = wireEndpointError(data, wiring.wires, from, to);
    if (message) { setError(message); return; }
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
  const patchCircuitPosition = (circuitId: string, point: Point) => {
    const current = data.circuits.find(circuit => circuit.id === circuitId);
    if (!current) return;
    const previous = current.boardConnections?.find(connection => connection.boardId === board.id)?.position;
    if (previous?.x === point.x && previous.y === point.y) return;
    onChange(setCircuitBoardPosition(data, circuitId, board.id, point));
  };
  const diagram = useWiringDiagram(data, board, wiring, { patchWire, patchBus, patchInfeed, patchCircuitPosition, placeDevice: onPlaceDevice, snapToGrid });
  const selectedWire = wiring.wires.find((wire) => wire.id === wireId);
  const selectedRoute = selectedWire ? diagram.route(selectedWire, wiring.wires.indexOf(selectedWire)) : [];
  const tools = <div className="wiring-actions">
    <button type="button" className="icon-button wiring-grid-button" aria-label={t('Rácshoz illesztés')} title={t('Rácshoz illesztés')} aria-pressed={snapToGrid} onClick={() => setSnapToGrid(value => !value)}><Grid3X3 size={19}/></button>
    <button type="button" className="icon-button wiring-grid-button" aria-label={t('Folyamatos bekötés')} title={t('Folyamatos bekötés')} aria-pressed={continuousWiring} onClick={() => { setContinuousWiring(value => !value); setError(''); }}><Cable size={19}/></button>
    {selectedWire && selectedRoute.length >= 2 && <>
      <button type="button" className="icon-button wiring-grid-button" aria-label={t('Töréspont hozzáadása')} title={t('Töréspont hozzáadása')} onClick={() => patchWire(selectedWire.id, { points:insertWireBend(selectedRoute,snapToGrid) })}><Plus size={19}/></button>
      <button type="button" className="icon-button wiring-grid-button" aria-label={t('Kijelölt vezeték törlése')} title={t('Kijelölt vezeték törlése')} onClick={() => { update(value => { value.wires = value.wires.filter(wire => wire.id !== selectedWire.id); }); setWireId(undefined); }}><Trash2 size={19}/></button>
    </>}
  </div>;

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
          {circuitConnector && <p className="field-note" role="status">
            {t('Kiválasztott áramköri vezető: {conductor}. Kattints az elosztó megfelelő kapcsára.', { conductor: circuitConnector.conductor })}
            {' '}<button type="button" className="quiet" onClick={() => { setCircuitConnector(undefined); setError(''); }}>{t('Mégse')}</button>
          </p>}
          {actionHost ? createPortal(tools, actionHost) : tools}
          <div className="wiring-diagram-container">
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
            onNotify={onNotify}
            onReconnectEndpoint={(id, side, endpoint) => patchWire(id, { [side]: endpoint })}
            selectedCircuitConnector={circuitConnector}
            onSelectCircuitConnector={selectCircuitConnector}
          />
          </div>
          <BoardCircuitPanel data={data} board={board} onChange={onChange}/>
          <p className="subtle">
            {t(
              'Válassz két konkrét csatlakozópontot a rajzon vagy a listákban, majd hozd létre a vezetéket. A kattintási sorrend szabad.'
            )}
          </p>
          {continuousWiring && <p className="subtle">{t('A kezdőpont megmarad a vezeték létrehozása után. Válassz új végpontot a következő bekötéshez.')}</p>}
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
              'A kijelölt vezeték végeit másik csatlakozópontra húzhatod. A végpontok az alábbi listákból is módosíthatók.'
            )}
          </p>
          <div className="wiring-panels">
            <WirePanel
              data={data}
              wires={wiring.wires}
              selectedWireId={wireId}
              selectedRoute={selectedRoute}
              snapToGrid={snapToGrid}
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
              onNotify={onNotify}
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
              {loadPhases(data, loads).map((phase) => (
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
