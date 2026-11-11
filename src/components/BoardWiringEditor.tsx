import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Cable, Plus } from 'lucide-react';
import { t, getLocale } from '../i18n';
import { uid, makeDevice } from '../catalog';
import { placeBoardDevice } from '../data/boardPlacement';
import { defaultWireColor } from '../data/wireColors';
import { loadPhases } from '../data/projectPhases';
import { isBoardRouteTerminalCompatible } from '../data/boardRouteConnections';
import { assignFloorRouteTerminal } from '../data/floorRouteProtection';
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
import { FloorBoardRoutes } from './FloorBoardRoutes';
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
}
const EMPTY: BoardWiring = { buses: [], wires: [], infeeds: [] };

export function BoardWiringEditor({ data, board, selectedId, onChange, onNotify, onSelect, onPlaceDevice }: Props) {
  const [fromValue, setFromValue] = useState('');
  const [toValue, setToValue] = useState('');
  const [continuousWiring, setContinuousWiring] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [wireId, setWireId] = useState<string>();
  const [error, setError] = useState('');
  const [estimate, setEstimate] = useState<WireEstimate>();
  const [floorConnector, setFloorConnector] = useState<{ sheetId: string; routeId: string; conductor: Conductor }>();
  const wiring = board.wiring ?? EMPTY;
  const locale = getLocale();
  const issues = useMemo(() => getWiringIssues(data, board), [data, board, locale]);
  const loads = useMemo(() => getPhaseLoads(data, board), [data, board]);
  useEffect(() => {
    if (selectedId) setWireId(undefined);
  }, [selectedId]);
  useEffect(() => { setFloorConnector(undefined); }, [board.id]);
  useEffect(() => {
    if (!floorConnector) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') { setFloorConnector(undefined); setError(''); } };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [floorConnector]);
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
  const connectFloorEndpoint = (selection: { sheetId: string; routeId: string; conductor: Conductor }, endpoint: WiringEndpoint) => {
    if (!isBoardRouteTerminalCompatible(data, board.id, selection.conductor, endpoint)) {
      const message = t('Ez a kapocs nem ehhez az elosztóhoz vagy vezetőhöz tartozik. Válassz megfelelő kapcsot.');
      setError(message); onNotify(message); return false;
    }
    const next = assignFloorRouteTerminal(data, selection.sheetId, selection.routeId, board.id, selection.conductor, endpoint);
    if (next === data) {
      const message = t('A nyomvonal vagy a kapocs megváltozott. Válaszd ki újra a végpontokat.');
      setError(message); onNotify(message); return false;
    }
    onChange(next); setFloorConnector(undefined); setFromValue(''); setToValue(''); setError('');
    onNotify(t('Az alaprajzi vezető a kiválasztott kapocshoz került.'));
    return true;
  };
  const selectFloorConnector = (sheetId: string, routeId: string, conductor: Conductor) => {
    const selection = { sheetId, routeId, conductor };
    if (floorConnector?.sheetId === sheetId && floorConnector.routeId === routeId && floorConnector.conductor === conductor) {
      setFloorConnector(undefined); setError(''); return;
    }
    const first = !toValue ? parseEndpoint(fromValue) : undefined;
    setWireId(undefined); onSelect(null); setError('');
    if (first && connectFloorEndpoint(selection, first)) return;
    setFromValue(''); setToValue(''); setFloorConnector(selection);
  };
  const selectEndpoint = (endpoint: WiringEndpoint) => {
    onSelect(null);
    setError('');
    if (floorConnector) { connectFloorEndpoint(floorConnector, endpoint); return; }
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
  const patchFloorPosition = (sheetId: string, routeId: string, point: Point) => {
    const current = data.sheets.find(sheet => sheet.id === sheetId)?.routes.find(route => route.id === routeId);
    if (!current || (current.fromBoardId !== board.id && current.toBoardId !== board.id)) return;
    const previous = current.boardPositions?.find(position => position.boardId === board.id);
    if (previous?.x === point.x && previous.y === point.y) return;
    const next = structuredClone(data);
    const route = next.sheets.find(sheet => sheet.id === sheetId)!.routes.find(item => item.id === routeId)!;
    route.boardPositions = [...(route.boardPositions ?? []).filter(position => position.boardId !== board.id), { boardId:board.id, ...point }];
    onChange(next);
  };
  const diagram = useWiringDiagram(data, board, wiring, { patchWire, patchBus, patchInfeed, patchFloorPosition, placeDevice: onPlaceDevice, snapToGrid });
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
          <FloorBoardRoutes data={data} board={board} onChange={onChange}/>
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
          {floorConnector && <p className="field-note" role="status">
            {t('Kiválasztott alaprajzi vezető: {conductor}. Kattints az elosztó megfelelő kapcsára.', { conductor: floorConnector.conductor })}
            {' '}<button type="button" className="quiet" onClick={() => { setFloorConnector(undefined); setError(''); }}>{t('Mégse')}</button>
          </p>}
          <div className="row-actions wiring-grid-control">
            <button type="button" className="quiet wiring-mode-toggle" aria-pressed={snapToGrid} onClick={() => setSnapToGrid(value => !value)}>{t('Rácshoz illesztés')}</button>
            {snapToGrid && <span className="subtle">{t('Húzáskor a töréspontok a rácshoz illeszkednek; a vezeték derékszögű marad.')}</span>}
          </div>
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
            selectedFloorConnector={floorConnector}
            onSelectFloorConnector={selectFloorConnector}
          />
          {selectedWire && selectedRoute.length >= 2 && (
            <div className="wiring-floating-tools">
              <button
                type="button"
                aria-label={t('Töréspont hozzáadása')}
                title={t('Töréspont hozzáadása')}
                onClick={() => patchWire(selectedWire.id, { points: insertWireBend(selectedRoute, snapToGrid) })}
              >
                <Plus size={18} aria-hidden="true" />
                <span>{t('Töréspont hozzáadása')}</span>
              </button>
            </div>
          )}
          </div>
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
