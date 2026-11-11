import type { Circuit, Device } from '../types';

/**
 * Drawing roles describe the documented device function, not its connection
 * state. The renderer must connect only the terminal nets recorded in the
 * project; in particular these glyphs do not join different device poles.
 */
export type SingleLineDeviceRole =
  | 'supply' | 'main' | 'switch' | 'mcb' | 'rccb' | 'rcbo' | 'spd'
  | 'contactor' | 'meter' | 'terminal' | 'mpcb' | 'outlet' | 'relay' | 'unknown';
const electricalRoles: ReadonlySet<string> = new Set(['supply','main','mcb','rccb','rcbo','spd','contactor','meter','terminal','mpcb','outlet']);

export function getSingleLineDeviceRole(device?: Device): SingleLineDeviceRole {
  // An explicit electrical role is more specific than the catalog's `custom`
  // kind. In particular the three board presets must not share one glyph.
  if (device?.electrical?.role && electricalRoles.has(device.electrical.role)) return device.electrical.role;
  if (device?.variant === 'board-terminal') return 'terminal';
  if (device?.variant === 'board-mpcb') return 'mpcb';
  if (device?.variant === 'board-meter') return 'meter';
  switch (device?.kind) {
    case 'breaker': return 'mcb';
    case 'rcd': return 'rccb';
    case 'rcbo': return 'rcbo';
    case 'spd': return 'spd';
    case 'main': return 'main';
    case 'switch': return 'switch';
    case 'outlet': return 'outlet';
    case 'relay': return 'relay';
    default: return 'unknown';
  }
}

/**
 * Only explicit product or pole data may label a symbol. In particular module
 * width does not establish the number of poles or which poles are protected.
 */
export function getSingleLinePoleLabel(device?: Device): string | undefined {
  const product = device?.product?.poles?.trim();
  const poles = device?.electrical?.poles;
  if (poles?.length) {
    const match = product?.toUpperCase().replace(/\s/g,'').match(/^(\d+)P(\+N)?$/);
    const count = match ? Number(match[1]) + (match[2] ? 1 : 0) : undefined;
    // A user-edited pole list overrides stale or unverifiable product data.
    return count === poles.length ? `${product} · ${poles.join(' / ')}` : poles.join(' / ');
  }
  return product || undefined;
}

type Placement = { x?: number; y?: number; height?: number };

/**
 * Simplified functional glyphs inspired by the supplied cabinet designer.
 * Their IEC 60617 symbol-by-symbol certification has not been established.
 * Input and output anchors are (x,y) and (x,y+height). No colour conveys a
 * connection and no protective earth is invented for the SPD symbol.
 */
export function drawSingleLineDeviceSymbol(device?: Device, options: Placement = {}): string {
  const { x = 0, y = 0, height = 60 } = options;
  if (![x,y,height].every(Number.isFinite) || height <= 0) return '';
  const role = getSingleLineDeviceRole(device);
  const common = 'fill="none" stroke="#161616" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
  const lead = '<path d="M0 0V8M0 52V60"/>';
  const sw = '<path d="M0 8V20M0 40V52M0 40L11 21"/><circle cx="0" cy="20" r="2" fill="#fff"/><circle cx="0" cy="40" r="2" fill="#fff"/>';
  const overload = '<path d="M-4 16L4 24M-4 24L4 16"/>';
  const residual = '<circle cx="0" cy="46" r="5.5" fill="#fff"/><path d="M0 40V52"/>';
  let body: string;
  switch (role) {
    case 'supply':
      body = '<path d="M0 8V52M-7 16L0 23L7 16"/><circle cx="0" cy="8" r="3" fill="#161616"/>';
      break;
    case 'main':
      body = sw + '<path d="M-7 34L1 30"/>';
      break;
    case 'switch':
      body = sw;
      break;
    case 'mcb':
      body = sw + overload;
      break;
    case 'rccb':
      body = sw + residual;
      break;
    case 'rcbo':
      body = sw + overload + residual;
      break;
    case 'mpcb':
      body = sw + overload + '<rect x="-24" y="27" width="10" height="17"/><path d="M-14 35L-3 32" stroke-dasharray="3 2"/><path d="M-22 40Q-20 34-18 40T-14 40"/>';
      break;
    case 'contactor':
      body = sw + '<rect x="-24" y="27" width="10" height="17"/><path d="M-14 35L-3 32" stroke-dasharray="3 2"/>';
      break;
    case 'terminal':
      body = '<path d="M0 8V24M0 36V52"/><rect x="-10" y="24" width="20" height="12"/><path d="M-6 33L-3 27M3 33L6 27"/>';
      break;
    case 'meter':
      body = '<path d="M0 8V16M0 44V52"/><circle cx="0" cy="30" r="14"/><text x="0" y="33" fill="#161616" stroke="none" font-size="8" text-anchor="middle">kWh</text>';
      break;
    case 'spd':
      body = '<path d="M0 8V18M0 42V52"/><rect x="-7" y="18" width="14" height="24"/><path d="M-10 45L10 15M5 15H10V20"/>';
      break;
    case 'outlet':
      body = '<path d="M0 8V20M0 40V52"/><circle cx="0" cy="30" r="10"/><path d="M-10 30H10"/>';
      break;
    case 'relay':
      body = '<path d="M0 8V18M0 42V52"/><rect x="-11" y="18" width="22" height="24"/><text x="0" y="34" fill="#161616" stroke="none" font-size="11" text-anchor="middle">K</text>';
      break;
    default:
      body = '<path d="M0 8V18M0 42V52"/><rect x="-11" y="18" width="22" height="24"/><text x="0" y="34" fill="#161616" stroke="none" font-size="12" text-anchor="middle">?</text>';
  }
  return `<g data-sld-role="${role}" transform="translate(${x} ${y}) scale(1 ${height / 60})" ${common}>${lead}${body}</g>`;
}

/** Earth is an explicit net/source symbol, never an automatic SPD connection. */
export function drawSingleLineGroundSymbol(x = 0, y = 0): string {
  if (![x,y].every(Number.isFinite)) return '';
  return `<g data-sld-role="earth" transform="translate(${x} ${y})" fill="none" stroke="#161616" stroke-width="1.7"><path d="M0 0V9M-9 9H9M-6 13H6M-3 17H3"/></g>`;
}

/** A consumer glyph is a drawing annotation; it does not create a connection. */
export function drawSingleLineLoadSymbol(type: Circuit['loadType'], x = 0, y = 0): string {
  if (![x,y].every(Number.isFinite)) return '';
  const role = type === 'socket' || type === 'lamp' || type === 'motor' ? type : 'other';
  const glyph = role === 'socket' ? '<circle cx="0" cy="18" r="9"/><path d="M-9 18H9"/>'
    : role === 'lamp' ? '<circle cx="0" cy="18" r="9"/><path d="M-6 12L6 24M6 12L-6 24"/>'
    : role === 'motor' ? '<circle cx="0" cy="18" r="10"/><text x="0" y="22" fill="#161616" stroke="none" font-size="11" text-anchor="middle">M</text>'
    : '<rect x="-9" y="9" width="18" height="18"/>';
  const leadEnd = role === 'motor' ? 8 : 9;
  return `<g data-sld-load="${role}" transform="translate(${x} ${y})" fill="none" stroke="#161616" stroke-width="1.5"><path d="M0 0V${leadEnd}"/>${glyph}</g>`;
}
