import { RotateCcw, Trash2 } from 'lucide-react';
import { t, getLocale } from '../../i18n';
import { endpointConductor, estimateVoltageDrop, wiringEndpointLabel } from '../../data/boardWiring';
import { wireColorAppearance, wireColorPresets } from '../../data/wireColors';
import type { BoardWire, Point, ProjectData, WiringEndpoint } from '../../types';
import { CableFields } from '../ElectricalDeviceFields';
import { encodeEndpoint, parseEndpoint } from './endpoints';
import type { EndpointOption } from './endpoints';
import { moveWireBend, removeWireBend } from './wireEditing';

interface EndpointSelectProps {
  data: ProjectData;
  endpoints: EndpointOption[];
  value: string;
  onChange: (value: string) => void;
  title: string;
}
export function EndpointSelect({ data, endpoints, value, onChange, title }: EndpointSelectProps) {
  return (
    <label>
      {title}
      <select
        aria-label={title}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">{t('Csatlakozópont kiválasztása')}</option>
        {value && !endpoints.some((endpoint) => encodeEndpoint(endpoint.value) === value) && (
          <option value={value}>{wiringEndpointLabel(data, parseEndpoint(value)!)}</option>
        )}
        {data.boards.map((cabinet) => (
          <optgroup key={cabinet.id} label={cabinet.name}>
            {endpoints
              .filter((endpoint) => endpoint.group === cabinet.id)
              .map((endpoint) => (
                <option key={encodeEndpoint(endpoint.value)} value={encodeEndpoint(endpoint.value)}>
                  {endpoint.text}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export interface WireEstimate {
  wireId: string;
  current?: number;
  voltage: number;
  threePhase: boolean;
}

interface Props {
  data: ProjectData;
  wires: BoardWire[];
  selectedWireId?: string;
  selectedRoute: Point[];
  snapToGrid: boolean;
  endpoints: EndpointOption[];
  onSelectWire: (id: string) => void;
  onPatchWire: (id: string, patch: Partial<BoardWire>) => void;
  onDeleteWire: (id: string) => void;
  onClearError: () => void;
  onNotify: (message: string) => void;
  estimate?: WireEstimate;
  onEstimateChange: (estimate: WireEstimate) => void;
}

export function WirePanel({
  data,
  wires,
  selectedWireId,
  selectedRoute,
  snapToGrid,
  endpoints,
  onSelectWire,
  onPatchWire,
  onDeleteWire,
  onClearError,
  onNotify,
  estimate,
  onEstimateChange
}: Props) {
  const selectedWire = wires.find((wire) => wire.id === selectedWireId);
  const selectedColor = selectedWire
    ? wireColorAppearance(selectedWire, endpointConductor(data, selectedWire.from) ?? 'L')
    : undefined;
  const label = (endpoint: WiringEndpoint) => wiringEndpointLabel(data, endpoint);
  const endpointSelect = (value: string, onChange: (value: string) => void, title: string) => (
    <EndpointSelect
      data={data}
      endpoints={endpoints}
      value={value}
      title={title}
      onChange={(value) => {
        onClearError();
        onChange(value);
      }}
    />
  );
  const currentEndpoint =
    selectedWire?.to.kind === 'device'
      ? selectedWire.to
      : selectedWire?.from.kind === 'device'
        ? selectedWire.from
        : undefined;
  const currentDevice = currentEndpoint
    ? data.devices.find((device) => device.id === currentEndpoint.deviceId)
    : undefined;
  const settings =
    estimate && estimate.wireId === selectedWire?.id
      ? estimate
      : {
          wireId: selectedWire?.id ?? '',
          current: currentDevice?.electrical?.currentA,
          voltage: 230,
          threePhase: false
        };
  const setEstimateValue = (patch: Partial<WireEstimate>) => onEstimateChange({ ...settings, ...patch });
  const current = settings.current;
  const drop =
    selectedWire && current !== undefined
      ? estimateVoltageDrop(selectedWire.cable, current, settings.voltage, settings.threePhase)
      : undefined;
  return (
    <div className="wiring-panel">
      <h4>{t('Vezetékek')}</h4>
      {!wires.length && <p className="subtle">{t('Még nincs részletes vezeték.')}</p>}
      <div className="wiring-wire-list">
        {wires.map((wire) => (
          <button
            key={wire.id}
            className={selectedWireId === wire.id ? 'selected' : ''}
            aria-pressed={selectedWireId === wire.id}
            onClick={() => onSelectWire(wire.id)}
          >
            <i
              aria-hidden="true"
              style={{ background: wireColorAppearance(wire, endpointConductor(data, wire.from) ?? 'L').swatch }}
            />
            <span>{wire.label || `${label(wire.from)} → ${label(wire.to)}`}</span>
          </button>
        ))}
      </div>
      {selectedWire && (
        <div className="wiring-wire-editor">
          <strong>
            {label(selectedWire.from)} → {label(selectedWire.to)}
          </strong>
          {endpointSelect(
            encodeEndpoint(selectedWire.from),
            (value) => {
              if (value) onPatchWire(selectedWire.id, { from: parseEndpoint(value)! });
            },
            t('Kijelölt vezeték kezdőpontja')
          )}
          {endpointSelect(
            encodeEndpoint(selectedWire.to),
            (value) => {
              if (value) onPatchWire(selectedWire.id, { to: parseEndpoint(value)! });
            },
            t('Kijelölt vezeték végpontja')
          )}
          <label>
            {t('Vezeték felirata')}
            <input
              aria-label={t('Vezeték felirata')}
              value={selectedWire.label ?? ''}
              onChange={(e) => onPatchWire(selectedWire.id, { label: e.target.value })}
            />
          </label>
          <fieldset className="wiring-color-palette">
            <legend>{t('Vezeték színe')}</legend>
            <div className="wiring-color-presets">
              {wireColorPresets.map((preset) => {
                const pattern = 'colorPattern' in preset ? preset.colorPattern : undefined;
                const appearance = wireColorAppearance({ color: preset.color, colorPattern: pattern });
                return (
                  <button
                    type="button"
                    key={preset.label}
                    aria-label={t('Vezetékszín: {color}', { color: t(preset.label) })}
                    aria-pressed={selectedColor?.color.toLowerCase() === preset.color && !!selectedColor?.stripe === !!appearance.stripe}
                    title={t(preset.label)}
                    onClick={() => onPatchWire(selectedWire.id, { color: preset.color, colorPattern: pattern })}
                  >
                    <i aria-hidden="true" style={{ background: appearance.swatch }} />
                    {t(preset.label)}
                  </button>
                );
              })}
            </div>
            <label className="wiring-color-field">
              {t('Egyéni vezetékszín')}
              <input
                aria-label={t('Egyéni vezetékszín')}
                type="color"
                value={selectedColor?.color}
                onChange={(e) => onPatchWire(selectedWire.id, { color: e.target.value, colorPattern: undefined })}
              />
            </label>
          </fieldset>
          <CableFields cable={selectedWire.cable} onChange={(cable) => onPatchWire(selectedWire.id, { cable })} />
          <fieldset className="wiring-cable">
            <legend>{t('Feszültségesés-becslés')}</legend>
            <div className="wiring-field-grid">
              <label>
                {t('Becsült terhelőáram (A)')}
                <input
                  aria-label={t('Becsült terhelőáram (A)')}
                  type="number"
                  min="0"
                  step="any"
                  value={current ?? ''}
                  onChange={(e) =>
                    setEstimateValue({
                      current: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value))
                    })
                  }
                />
              </label>
              <label>
                {t('Névleges feszültség (V)')}
                <input
                  aria-label={t('Névleges feszültség (V)')}
                  type="number"
                  min="1"
                  step="any"
                  value={settings.voltage}
                  onChange={(e) => {
                    const voltage = Number(e.target.value);
                    if (voltage > 0) setEstimateValue({ voltage });
                  }}
                />
              </label>
            </div>
            <label>
              {t('Számítási rendszer')}
              <select
                aria-label={t('Számítási rendszer')}
                value={settings.threePhase ? 'three' : 'single'}
                onChange={(e) => setEstimateValue({ threePhase: e.target.value === 'three' })}
              >
                <option value="single">{t('Egyfázisú, oda-vissza vezető')}</option>
                <option value="three">{t('Szimmetrikus háromfázisú')}</option>
              </select>
            </label>
          </fieldset>
          <p className="subtle">
            {drop
              ? t('Becsült feszültségesés: {volts} V ({percent}%), {current} A terhelőárammal.', {
                  volts: drop.volts.toLocaleString(getLocale(), { maximumFractionDigits: 2 }),
                  percent: drop.percent.toLocaleString(getLocale(), { maximumFractionDigits: 2 }),
                  current: current!
                })
              : t(
                  'Feszültségesés-becsléshez add meg a gyártói ellenállást, a hosszt és a kapcsolódó készülék névleges áramát.'
                )}
          </p>
          <details open>
            <summary>{t('Nyomvonal és felirat helye')}</summary>
            <p className="subtle">{t('A rajzon húzd a pontokat vagy szakaszokat a vezeték alakításához. A töréspontokat itt is törölheted.')}</p>
            {selectedRoute.slice(1, -1).map((point, index) => (
              <div className="wiring-coordinate" key={index}>
                <span>{t('{number}. töréspont', { number: index + 1 })}</span>
                {(['x', 'y'] as const).map((axis) => (
                  <label key={axis}>
                    {axis}
                    <input
                      aria-label={t('{number}. töréspont {axis}', { number: index + 1, axis })}
                      type="number"
                      value={point[axis]}
                      onChange={(e) => {
                        const next = { ...point, [axis]: Number(e.target.value) };
                        onPatchWire(selectedWire.id, { points: moveWireBend(selectedRoute, index + 1, next, snapToGrid).route.slice(1, -1) });
                      }}
                    />
                  </label>
                ))}
                <button
                  className="icon-button"
                  aria-label={t('{number}. töréspont törlése', { number: index + 1 })}
                  onClick={() => {
                    const points = removeWireBend(selectedRoute, index, snapToGrid);
                    if (points.length === selectedRoute.length - 2 && points.every((point, i) => point.x === selectedRoute[i + 1].x && point.y === selectedRoute[i + 1].y)) {
                      onNotify(t('A töréspont nem törölhető: a két végpont között legalább egy sarok szükséges.'));
                    } else onPatchWire(selectedWire.id, { points });
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div className="wiring-coordinate">
              <span>{t('Felirat helye')}</span>
              {(['x', 'y'] as const).map((axis) => (
                <label key={axis}>
                  {axis}
                  <input
                    aria-label={t('Felirat {axis}', { axis })}
                    type="number"
                    value={selectedWire.labelOffset?.[axis] ?? 0}
                    onChange={(e) =>
                      onPatchWire(selectedWire.id, {
                        labelOffset: {
                          x: selectedWire.labelOffset?.x ?? 0,
                          y: selectedWire.labelOffset?.y ?? 0,
                          [axis]: Number(e.target.value)
                        }
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <div className="row-actions">
            <button
              className="quiet"
              onClick={() => onPatchWire(selectedWire.id, { points: undefined, labelOffset: undefined })}
            >
              <RotateCcw size={14} />
              {t('Nyomvonal alaphelyzetbe')}
            </button>
            <button
              className="danger-button"
              onClick={() => {
                onDeleteWire(selectedWire.id);
              }}
            >
              <Trash2 size={14} />
              {t('Vezeték törlése')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
