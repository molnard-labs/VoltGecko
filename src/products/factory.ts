import { makeDevice, uid } from '../catalog';
import { findFreeBoardSlot } from '../data/boardPlacement';
import { getLanguage, t } from '../i18n';
import type { Board, Device, Point, ProjectData } from '../types';
import type { CatalogProduct, ProductSnapshot } from './types';

/** Copy manufacturer facts into the project; later catalog updates must not alter a plan. */
function snapshot(product: CatalogProduct): ProductSnapshot {
  const facts: ProductSnapshot = {
    reference: product.reference, manufacturer: product.manufacturer, range: product.range,
    sourceUrl: product.sourceUrl, sourceDocument: product.sourceDocument,
    sourcePage: product.sourcePage, verifiedAt: product.verifiedAt, mounting: product.mounting,
    description: { ...product.description },
  };
  for (const key of ['moduleWidth', 'widthMm', 'poles', 'currentA', 'curve', 'breakingCapacityKa', 'residualType', 'residualCurrentMa', 'voltage', 'boardRows', 'modulesPerRow', 'supplementalSourceUrl'] as const) {
    const value = product[key];
    if (value !== undefined) Object.assign(facts, { [key]: value });
  }
  return facts;
}

function rating(product: CatalogProduct): string {
  const values = [
    product.poles,
    product.currentA !== undefined ? `${product.curve ?? ''}${product.currentA} A` : product.curve,
    product.breakingCapacityKa !== undefined ? `${product.breakingCapacityKa} kA` : undefined,
    product.residualType,
    product.residualCurrentMa !== undefined ? `${product.residualCurrentMa} mA` : undefined,
    product.voltage,
  ];
  return values.filter(Boolean).join(' · ');
}

function verified(product: CatalogProduct): boolean {
  try {
    const validSource = (value: string): boolean => {
      const source = new URL(value);
      return source.protocol === 'https:' && !source.username && !source.password && !/[\u0000-\u0020\u007f]/.test(value);
    };
    return Boolean(product.reference.trim() && product.manufacturer.trim() && product.sourceDocument.trim()
      && Number.isInteger(product.sourcePage) && product.sourcePage > 0
      && Number.isFinite(Date.parse(product.verifiedAt))
      && validSource(product.sourceUrl)
      && (product.supplementalSourceUrl === undefined || validSource(product.supplementalSourceUrl)));
  } catch { return false; }
}

/** Match electrical function, rather than simply accepting any wall-mounted product.
 * An IP44 socket is still a single socket, and the indicator on a push button
 * does not change its switching function. Neither changes the plan symbol. */
export function canAssignFloorProduct(device: Device, product: CatalogProduct): boolean {
  if (product.mounting !== 'floor' || product.category === 'floor-accessory' || device.kind !== product.kind) return false;

  // A generic custom symbol carries no information that can distinguish a USB
  // charger, a speaker outlet or a cable outlet. Do not assert compatibility.
  if (device.kind === 'custom' && !device.variant) return false;

  // The standard data outlet is explicitly RJ45; the catalogue also uses
  // custom-data for HDMI and fibre outlets, which are different connections.
  if (device.kind === 'custom' && device.variant === 'custom-data' && !/rj\s*45/i.test(product.name.hu)) return false;
  // A satellite-only socket is not a TV socket, although both use the generic
  // catalogue icon. Combined TV/SAT sockets do provide the TV connection.
  if (device.kind === 'custom' && device.variant === 'custom-tv' && !/\btv\b/i.test(product.name.hu)) return false;

  // The current catalogue has no dedicated variants for these functions;
  // their generic switch/push-button classifications cannot prove a match.
  if (product.kind === 'switch') {
    const name = product.name.hu.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (name.includes('redony') || name.includes('harmas kapcsol') || name.includes('kartyas kapcsol') || name.includes('kettos nyomo')) return false;
  }

  if (device.variant === product.variant) return true;
  if (device.kind === 'outlet') {
    const singleSocket = (variant: Device['variant']) => variant === undefined || variant === 'outlet-weatherproof';
    return singleSocket(device.variant) && singleSocket(product.variant);
  }
  if (device.kind === 'switch') {
    const pushButton = (variant: Device['variant']) => variant === 'switch-push-button' || variant === 'switch-push-button-lit';
    return pushButton(device.variant) && pushButton(product.variant);
  }
  return false;
}

/** Assign the manufacturer snapshot without altering the existing plan or its electrical data. */
export function assignFloorProduct(device: Device, product: CatalogProduct): Device {
  if (!verified(product)) throw new Error(t('A termék gyártói forrása nincs ellenőrizve.'));
  if (!canAssignFloorProduct(device, product)) throw new Error(t('A termék nem felel meg a kijelölt eszköz típusának.'));
  return { ...device, model: `${product.manufacturer} ${product.reference}`, product: snapshot(product) };
}

export function createDeviceFromProduct(product: CatalogProduct, devices: Device[], boardId?: string): Device {
  if (!verified(product)) throw new Error(t('A termék gyártói forrása nincs ellenőrizve.'));
  if (product.mounting === 'enclosure') throw new Error(t('Az elosztóházat új elosztóként kell hozzáadni.'));
  if (product.mounting === 'din' && (!Number.isFinite(product.moduleWidth) || product.moduleWidth! <= 0)) {
    throw new Error(t('A készülékhez ellenőrzött gyártói modulszélesség szükséges.'));
  }
  const device = makeDevice(product.kind, devices, product.variant);
  device.name = product.name[getLanguage()];
  device.model = `${product.manufacturer} ${product.reference}`;
  device.rating = rating(product);
  device.product = snapshot(product);
  if (product.electrical) device.electrical = structuredClone(product.electrical);
  if (boardId) device.boardId = boardId;
  if (product.mounting === 'din') device.moduleWidth = product.moduleWidth;
  else { delete device.moduleWidth; device.quantity = 1; }
  return device;
}

function makeBoard(name = t('Lakáselosztó'), rows = 1, capacity = 12): Board {
  return { id: uid(), name, rows: Array.from({ length: rows }, (_, index) => ({
    id: uid(), name: t('{number}. sor', { number: index + 1 }), capacity, placements: [],
  })) };
}

export function addProductToProject(data: ProjectData, product: CatalogProduct, activeBoardId?: string): {
  data: ProjectData; selectedId: string | null; boardId: string; placed: boolean;
} {
  if (!verified(product)) throw new Error(t('A termék gyártói forrása nincs ellenőrizve.'));
  if (product.mounting === 'floor') throw new Error(t('Az alaprajzi terméket a tervlapon kell elhelyezni.'));
  const next = structuredClone(data);
  if (product.mounting === 'enclosure') {
    if (!Number.isInteger(product.boardRows) || product.boardRows! <= 0 || product.boardRows! > 1000
      || !Number.isInteger(product.modulesPerRow) || product.modulesPerRow! <= 0 || product.modulesPerRow! > 100_000) {
      throw new Error(t('Az elosztóházhoz ellenőrzött sor- és modulkapacitás szükséges.'));
    }
    const board = makeBoard(`${product.name[getLanguage()]} · ${product.reference}`, product.boardRows, product.modulesPerRow);
    board.product = snapshot(product);
    next.boards.push(board);
    return { data: next, selectedId: null, boardId: board.id, placed: true };
  }
  if (!next.boards.length) next.boards.push(makeBoard());
  const board = next.boards.find(item => item.id === activeBoardId) ?? next.boards[0];
  const device = createDeviceFromProduct(product, next.devices, board.id);
  next.devices.push(device);
  // Accessories belong to the board's bill of materials and never consume rail space.
  if (product.mounting === 'accessory') return { data: next, selectedId: device.id, boardId: board.id, placed: true };
  const width = device.moduleWidth!;
  const lookup = new Map(next.devices.map(item => [item.id, item]));
  for (const row of board.rows) {
    const start = findFreeBoardSlot(row, lookup, width);
    if (start !== undefined) {
      row.placements.push({ deviceId: device.id, start });
      return { data: next, selectedId: device.id, boardId: board.id, placed: true };
    }
  }
  // Keep the selected product in the project so that the user can make room later.
  return { data: next, selectedId: device.id, boardId: board.id, placed: false };
}

/** Place a manufacturer-backed floor device, preserving the selected variant and product snapshot. */
export function addFloorProductToProject(data: ProjectData, product: CatalogProduct, sheetId: string, point: Point): {
  data: ProjectData; selectedId: string;
} {
  if (product.mounting !== 'floor' || product.category === 'floor-accessory')
    throw new Error(t('Ez a termék nem helyezhető el önállóan az alaprajzon.'));
  const next = structuredClone(data);
  const sheet = next.sheets.find(item => item.id === sheetId);
  if (!sheet) throw new Error(t('A kiválasztott tervlap nem található.'));
  const device = createDeviceFromProduct(product, next.devices);
  next.devices.push(device);
  sheet.placements.push({ deviceId: device.id, x: point.x, y: point.y, rotation: 0 });
  return { data: next, selectedId: device.id };
}
