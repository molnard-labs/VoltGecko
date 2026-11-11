import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../i18n';
import { uid } from '../../catalog';
import type { Board, BoardBus, BoardInfeed, BoardWiring, Conductor, Point, ProjectData } from '../../types';
import { CableFields, CONDUCTORS, PoleFields } from '../ElectricalDeviceFields';

interface Props {
  data: ProjectData;
  board: Board;
  wiring: BoardWiring;
  busOrigin: (bus: BoardBus) => Point;
  sourceOrigin: (source: BoardInfeed, index: number) => Point;
  onUpdate: (mutate: (wiring: BoardWiring) => void) => void;
  onPatchBus: (id: string, patch: Partial<BoardBus>) => void;
  onPatchInfeed: (id: string, patch: Partial<BoardInfeed>) => void;
  onNotify: (message: string) => void;
  onError: (message: string) => void;
  onClearError: () => void;
}

export function SourcesPanel({
  data,
  board,
  wiring,
  busOrigin,
  sourceOrigin,
  onUpdate,
  onPatchBus,
  onPatchInfeed,
  onNotify,
  onError,
  onClearError
}: Props) {
  const [poleFieldsVersion, setPoleFieldsVersion] = useState(0);
  const connectedEndpoints = data.boards.flatMap(
    (item) => item.wiring?.wires.flatMap((wire) => [wire.from, wire.to]) ?? []
  );
  const floorEndpoints = data.sheets.flatMap(sheet => sheet.routes.flatMap(route =>
    (route.boardTerminals ?? [])
      .filter(terminal => !data.circuitBoardMigration || route.legacyUnassignedBoards?.includes(terminal.boardId))
      .map(terminal => terminal.endpoint)));
  const circuitEndpoints = data.circuits.flatMap(circuit => (circuit.boardConnections ?? []).flatMap(connection => [
    ...connection.terminals.map(terminal => terminal.endpoint),
    ...(connection.legacyTerminalConflicts ?? []).flatMap(conflict => conflict.endpoints),
  ]));
  const assignedEndpoints = [...floorEndpoints, ...circuitEndpoints];
  const confirmFloorRemoval = () => window.confirm(t('Az érintett áramkörök és korábbi kapcsolatok kapocshozzárendelései törlődnek. Folytatod?'));
  return (
    <div className="wiring-panel">
      <h4>{t('Sínek és betáplálások')}</h4>
      <div className="row-actions">
        <button
          className="quiet"
          onClick={() =>
            onUpdate((value) =>
              value.buses.push({
                id: uid(),
                name: t('Új sín'),
                conductor: 'N',
                capacity: 12,
                position: 'bottom',
                terminalLabels: []
              })
            )
          }
        >
          <Plus size={14} />
          {t('Sín hozzáadása')}
        </button>
        <button
          className="quiet"
          onClick={() =>
            onUpdate((value) =>
              value.infeeds.push({
                id: uid(),
                name: t('Külső betáplálás'),
                kind: 'supply',
                poles: ['L', 'N', 'PE']
              })
            )
          }
        >
          <Plus size={14} />
          {t('Betáplálás hozzáadása')}
        </button>
      </div>
      {wiring.buses.map((bus, index) => (
        <details className="wiring-item" key={bus.id}>
          <summary>
            {bus.name} · {bus.conductor} · {bus.capacity}
          </summary>
          <label>
            {t('Sín neve')}
            <input
              aria-label={t('{number}. sín neve', { number: index + 1 })}
              value={bus.name}
              onChange={(e) => onPatchBus(bus.id, { name: e.target.value })}
            />
          </label>
          <div className="wiring-field-grid">
            <label>
              {t('Vezető')}
              <select
                aria-label={t('{number}. sín vezetője', { number: index + 1 })}
                value={bus.conductor}
                onChange={(e) => onPatchBus(bus.id, { conductor: e.target.value as Conductor })}
              >
                {CONDUCTORS.map((conductor) => (
                  <option key={conductor}>{conductor}</option>
                ))}
              </select>
            </label>
            <label>
              {t('Sín kapacitása')}
              <input
                aria-label={t('{number}. sín kapacitása', { number: index + 1 })}
                type="number"
                min="1"
                max="500"
                step="1"
                value={bus.capacity}
                onChange={(e) => {
                  const capacity = Number(e.target.value);
                  if (Number.isInteger(capacity) && capacity >= 1 && capacity <= 500) {
                    if (
                      connectedEndpoints.some(
                        (endpoint) =>
                          endpoint.kind === 'bus' && endpoint.busId === bus.id && endpoint.terminal >= capacity
                      ) ||
                      bus.terminalLabels.slice(capacity).some((label) => label.trim())
                    ) {
                      onError(t('A kapacitás nem csökkenthető a bekötött vagy feliratozott kapcsok alá.'));
                      return;
                    }
                    if (assignedEndpoints.some(endpoint => endpoint.kind === 'bus' && endpoint.busId === bus.id && endpoint.terminal >= capacity) && !confirmFloorRemoval()) {
                      e.currentTarget.value = String(bus.capacity);
                      return;
                    }
                    onPatchBus(bus.id, { capacity, terminalLabels: bus.terminalLabels.slice(0, capacity) });
                    onClearError();
                  }
                }}
              />
            </label>
            <label>
              {t('DIN-sor')}
              <select
                aria-label={t('{number}. sín DIN-sora', { number: index + 1 })}
                value={bus.rowId ?? ''}
                onChange={(e) => onPatchBus(bus.id, { rowId: e.target.value || undefined })}
              >
                <option value="">{t('Elosztó közös sínje')}</option>
                {board.rows.map((row) => (
                  <option value={row.id} key={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('Elhelyezkedés')}
              <select
                aria-label={t('{number}. sín elhelyezkedése', { number: index + 1 })}
                value={bus.position}
                onChange={(e) => onPatchBus(bus.id, { position: e.target.value as BoardBus['position'] })}
              >
                <option value="top">{t('Felül')}</option>
                <option value="bottom">{t('Alul')}</option>
              </select>
            </label>
          </div>
          <label>
            {t('Kapocsfeliratok, soronként egy')}
            <textarea
              aria-label={t('{number}. sín kapocsfeliratai', { number: index + 1 })}
              rows={3}
              value={bus.terminalLabels.join('\n')}
              onChange={(e) => {
                const labels = e.target.value.split('\n');
                if (labels.length > bus.capacity || labels.some((label) => label.length > 1000)) {
                  onError(
                    t('A kapocsfeliratok száma legfeljebb a sín kapacitása lehet, feliratonként 1000 karakterrel.')
                  );
                  return;
                }
                onPatchBus(bus.id, { terminalLabels: labels });
                onClearError();
              }}
            />
          </label>
          <div className="wiring-coordinate">
            <span>{t('Sín helye')}</span>
            {(['x', 'y'] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <input
                  aria-label={t('{number}. sín {axis}', { number: index + 1, axis })}
                  type="number"
                  value={busOrigin(bus)[axis]}
                  onChange={(e) =>
                    onPatchBus(bus.id, { offset: { ...busOrigin(bus), [axis]: Number(e.target.value) } })
                  }
                />
              </label>
            ))}
          </div>
          <div className="row-actions">
            <button className="quiet" onClick={() => onPatchBus(bus.id, { offset: undefined })}>
              {t('Hely alaphelyzetbe')}
            </button>
            <button
              className="danger-button"
              onClick={() => {
                if (connectedEndpoints.some((endpoint) => endpoint.kind === 'bus' && endpoint.busId === bus.id)) {
                  onNotify(t('A sínhez vezeték kapcsolódik. Előbb módosítsd vagy töröld a vezetéket.'));
                  return;
                }
                if (assignedEndpoints.some(endpoint => endpoint.kind === 'bus' && endpoint.busId === bus.id) && !confirmFloorRemoval()) return;
                onUpdate((value) => {
                  value.buses = value.buses.filter((item) => item.id !== bus.id);
                });
              }}
            >
              <Trash2 size={14} />
              {t('Sín törlése')}
            </button>
          </div>
        </details>
      ))}
      <h4>{t('Bejövő vezetékek')}</h4>
      <p className="subtle">{t('A betáplálást a rajzon húzással helyezheted el, pólusait vezetékekkel kötheted be.')}</p>
      {wiring.infeeds.map((source, index) => (
        <details className="wiring-item" key={source.id}>
          <summary>
            {source.name} · {source.poles.join('/')}{source.currentA !== undefined ? ` · ${source.currentA} A` : ''}
          </summary>
          <label>
            {t('Betáplálás neve')}
            <input
              aria-label={t('{number}. betáplálás neve', { number: index + 1 })}
              value={source.name}
              onChange={(e) => onPatchInfeed(source.id, { name: e.target.value })}
            />
          </label>
          <label>
            {t('Betáplálás típusa')}
            <select
              aria-label={t('{number}. betáplálás típusa', { number: index + 1 })}
              value={source.kind}
              onChange={(e) => onPatchInfeed(source.id, { kind: e.target.value as BoardInfeed['kind'] })}
            >
              <option value="supply">{t('Betáplálás')}</option>
              <option value="earth">{t('Földelés')}</option>
            </select>
          </label>
          <PoleFields
            key={`${source.id}-${poleFieldsVersion}`}
            label={t('{number}. betáplálás pólusai', { number: index + 1 })}
            poles={source.poles}
            onChange={(poles) => {
              if (
                connectedEndpoints.some(
                  (endpoint) =>
                    endpoint.kind === 'infeed' && endpoint.infeedId === source.id && endpoint.pole >= poles.length
                )
              ) {
                onError(t('A pólusszám nem csökkenthető a bekötött pólusok alá.'));
                return;
              }
              if (assignedEndpoints.some(endpoint => endpoint.kind === 'infeed' && endpoint.infeedId === source.id && endpoint.pole >= poles.length) && !confirmFloorRemoval()) {
                setPoleFieldsVersion(version => version + 1);
                return;
              }
              onPatchInfeed(source.id, { poles });
              onClearError();
            }}
          />
          <label>
            {t('Névleges áram (A)')}
            <input
              aria-label={t('{number}. betáplálás névleges árama (A)', { number: index + 1 })}
              type="number" min="0" max="1000000" step="any"
              value={source.currentA ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                const currentA = Number(value);
                if (value === '' || (Number.isFinite(currentA) && currentA > 0 && currentA <= 1_000_000))
                  onPatchInfeed(source.id, { currentA: value === '' ? undefined : currentA });
              }}
            />
          </label>
          <CableFields
            prefix={t('{number}. bejövő kábel', { number: index + 1 })}
            cable={source.cable}
            onChange={(cable) => onPatchInfeed(source.id, { cable })}
          />
          <div className="wiring-coordinate">
            <span>{t('Betáplálás helye')}</span>
            {(['x', 'y'] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <input
                  aria-label={t('{number}. betáplálás {axis}', { number: index + 1, axis })}
                  type="number"
                  value={sourceOrigin(source, index)[axis]}
                  onChange={(e) =>
                    onPatchInfeed(source.id, {
                      position: { ...sourceOrigin(source, index), [axis]: Number(e.target.value) }
                    })
                  }
                />
              </label>
            ))}
          </div>
          <div className="wiring-coordinate">
            <span>{t('Betáplálás feliratának eltolása')}</span>
            {(['x', 'y'] as const).map((axis) => (
              <label key={axis}>
                {axis}
                <input
                  aria-label={t('{number}. betáplálás felirata {axis}', { number: index + 1, axis })}
                  type="number"
                  value={source.labelOffset?.[axis] ?? 0}
                  onChange={(e) =>
                    onPatchInfeed(source.id, {
                      labelOffset: {
                        x: source.labelOffset?.x ?? 0,
                        y: source.labelOffset?.y ?? 0,
                        [axis]: Number(e.target.value)
                      }
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button
            className="danger-button"
            onClick={() => {
              if (
                connectedEndpoints.some((endpoint) => endpoint.kind === 'infeed' && endpoint.infeedId === source.id)
              ) {
                onNotify(t('A betápláláshoz vezeték kapcsolódik. Előbb módosítsd vagy töröld a vezetéket.'));
                return;
              }
                if (assignedEndpoints.some(endpoint => endpoint.kind === 'infeed' && endpoint.infeedId === source.id) && !confirmFloorRemoval()) return;
              onUpdate((value) => {
                value.infeeds = value.infeeds.filter((item) => item.id !== source.id);
              });
            }}
          >
            <Trash2 size={14} />
            {t('Betáplálás törlése')}
          </button>
        </details>
      ))}
    </div>
  );
}
