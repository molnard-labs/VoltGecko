import { t } from '../../i18n';
import type { Asset, Device, ProjectDocument } from '../../types';
import { isDeviceVariantForKind } from '../../catalog';
import { effectiveDevicePoles } from '../boardWiring';
import { isPlanImageAsset } from '../planAppearance';
import { fail, identifier, object, text, type JsonObject } from './format';
import { readAssets } from './assets';
import { isBoardPlannerSnapshot } from '../../services/plannerBridge';

const kinds = new Set([
  'outlet',
  'switch',
  'light',
  'junction',
  'sensor',
  'relay',
  'hub',
  'breaker',
  'rcd',
  'rcbo',
  'spd',
  'main',
  'blank',
  'custom'
]);
const statuses = new Set(['planned', 'installed', 'verified']);
function array(value: unknown, label: string, limit = 20_000): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > limit)
    fail(t('{label} hibás vagy túl hosszú lista.', { label: t(label) }));
}
function finite(value: unknown, label: string, max = 1_000_000_000): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > max)
    fail(t('{label} hibás szám.', { label: t(label) }));
}
function optionalId(value: unknown, label: string) {
  if (value !== undefined) identifier(value, label);
}
function timestamp(value: unknown, label: string): asserts value is string {
  text(value, label, 60);
  if (!Number.isFinite(Date.parse(value))) fail(t('{label} hibás dátum.', { label: t(label) }));
}
function uniqueIds(values: unknown[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    object(value, label);
    identifier(value.id, label);
    if (ids.has(value.id)) fail(t('{label}: ismétlődő azonosító ({id}).', { label: t(label), id: value.id }));
    ids.add(value.id);
  }
  return ids;
}
function reference(
  value: unknown,
  ids: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  label: string,
  optional = false
) {
  if (value === undefined && optional) return;
  identifier(value, label);
  if (!ids.has(value)) fail(t('{label}: hiányzó hivatkozás ({id}).', { label: t(label), id: value }));
}
function point(value: JsonObject, label: string) {
  finite(value.x, `${t(label)}.x`);
  finite(value.y, `${t(label)}.y`);
}

const conductors = new Set(['L', 'L1', 'L2', 'L3', 'N', 'PE', 'PEN']);
function positive(value: unknown, label: string, max = 1_000_000_000, zero = false): asserts value is number {
  finite(value, label, max);
  if (zero ? value < 0 : value <= 0) fail('a villamos adat a megengedett tartományon kívül esik.');
}
function poles(value: unknown) {
  array(value, 'Készülékpólusok', 64);
  for (const conductor of value)
    if (typeof conductor !== 'string' || !conductors.has(conductor)) fail('ismeretlen vezetőfunkció.');
}
function cableDetails(value: unknown) {
  if (value === undefined) return;
  object(value, 'Kábeladatok');
  if (value.designation !== undefined) text(value.designation, 'Kábel megnevezése', 5000);
  if (value.cores !== undefined) {
    positive(value.cores, 'Érszám', 1000);
    if (!Number.isInteger(value.cores)) fail('az érszám pozitív egész szám legyen.');
  }
  for (const key of ['crossSectionMm2', 'resistanceOhmPerKm'])
    if (value[key] !== undefined) positive(value[key], 'Kábeladatok', 1_000_000);
  if (value.lengthM !== undefined) positive(value.lengthM, 'Kábelhossz', 10_000_000, true);
  if (value.material !== undefined && value.material !== 'Cu' && value.material !== 'Al')
    fail('ismeretlen kábelanyag.');
}
function electrical(value: unknown) {
  if (value === undefined) return;
  object(value, 'Villamos adatok');
  poles(value.poles);
  if (value.physicalPoleOrder !== undefined) {
    array(value.physicalPoleOrder, 'Fizikai pólussorrend', 64);
    const order = value.physicalPoleOrder;
    const count = (value.poles as unknown[]).length;
    if (order.length !== count || new Set(order).size !== count || order.some(index =>
      typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= count))
      fail('hibás fizikai pólussorrend.');
  }
  if (value.commonPoleGroups !== undefined) {
    array(value.commonPoleGroups, 'Közös kapocscsoportok', 64);
    const grouped = new Set<number>();
    for (const group of value.commonPoleGroups) {
      array(group, 'Közös kapocscsoport', 64);
      if (group.length < 2) fail('egy közös kapocscsoport legalább két kapcsot tartalmazzon.');
      let conductor: unknown;
      for (const index of group) {
        finite(index, 'Kapocsszám', 63);
        if (!Number.isInteger(index) || index < 0 || index >= (value.poles as unknown[]).length || grouped.has(index))
          fail('hibás vagy átfedő közös kapocscsoport.');
        grouped.add(index);
        const current = (value.poles as unknown[])[index];
        if (conductor !== undefined && current !== conductor) fail('a közös kapcsok vezetőfunkciója legyen azonos.');
        conductor = current;
      }
    }
  }
  if (
    value.role !== undefined &&
    !['supply', 'main', 'mcb', 'rccb', 'rcbo', 'spd', 'contactor', 'meter', 'terminal', 'mpcb', 'outlet'].includes(
      value.role as string
    )
  )
    fail('ismeretlen villamos készülékszerep.');
  if (value.phase !== undefined && !['L1', 'L2', 'L3'].includes(value.phase as string)) fail('ismeretlen fázis.');
  for (const key of ['currentA', 'residualCurrentMa'])
    if (value[key] !== undefined) positive(value[key], 'Villamos adatok', 1_000_000);
  for (const key of ['curve', 'residualType', 'spdClass', 'group'])
    if (value[key] !== undefined) text(value[key], 'Villamos adatok', 20_000);
}

function validateWiring(value: JsonObject, devices: unknown[]) {
  const deviceLookup = new Map(
    devices.map((item) => {
      object(item, 'Készülék');
      return [item.id as string, item] as const;
    })
  );
  const busLookup = new Map<string, JsonObject>(),
    infeedLookup = new Map<string, JsonObject>();
  const boardValues = value.boards as JsonObject[];
  for (const board of boardValues) {
    if (board.wiring === undefined) continue;
    object(board.wiring, 'Huzalozás');
    const wiring = board.wiring;
    array(wiring.buses, 'Sínek', 20_000);
    array(wiring.infeeds, 'Betáplálások', 1000);
    array(wiring.wires, 'Vezetékek', 50_000);
    uniqueIds(wiring.wires, 'Vezeték');
    for (const bus of wiring.buses) {
      object(bus, 'Sín');
      identifier(bus.id, 'Sínazonosító');
      if (busLookup.has(bus.id)) fail('ismétlődő sínazonosító.');
      busLookup.set(bus.id, bus);
      text(bus.name, 'Sín neve', 1000);
      positive(bus.capacity, 'Sín kapacitása', 10_000);
      if (!Number.isInteger(bus.capacity)) fail('a sín kapacitása pozitív egész szám legyen.');
      if (!conductors.has(bus.conductor as string)) fail('ismeretlen vezetőfunkció.');
      if (bus.position !== 'top' && bus.position !== 'bottom') fail('ismeretlen sínpozíció.');
      if (bus.rowId !== undefined)
        reference(bus.rowId, new Set((board.rows as JsonObject[]).map((row) => row.id as string)), 'Sín sora');
      array(bus.terminalLabels, 'Kapocsfeliratok', 10_000);
      for (const label of bus.terminalLabels) text(label, 'Kapocsfelirat', 1000);
      if (bus.terminalLabels.length > bus.capacity) fail('több kapocsfelirat van, mint sínkapocs.');
      if (bus.offset !== undefined) {
        object(bus.offset, 'Sín eltolása');
        point(bus.offset, 'Sín eltolása');
      }
    }
    for (const infeed of wiring.infeeds) {
      object(infeed, 'Betáplálás');
      identifier(infeed.id, 'Betáplálás-azonosító');
      if (infeedLookup.has(infeed.id)) fail('ismétlődő betáplálás-azonosító.');
      infeedLookup.set(infeed.id, infeed);
      text(infeed.name, 'Betáplálás neve', 1000);
      poles(infeed.poles);
      if (infeed.currentA !== undefined) positive(infeed.currentA, 'Névleges áram (A)', 1_000_000);
      cableDetails(infeed.cable);
      if (infeed.kind !== 'supply' && infeed.kind !== 'earth') fail('ismeretlen betáplálástípus.');
      for (const key of ['position', 'labelOffset'])
        if (infeed[key] !== undefined) {
          object(infeed[key], 'Betáplálás pozíciója');
          point(infeed[key], 'Betáplálás pozíciója');
        }
    }
    if (wiring.demandFactor !== undefined) {
      positive(wiring.demandFactor, 'Egyidejűségi tényező', 1, true);
    }
  }
  const endpoint = (item: unknown) => {
    object(item, 'Vezetékvégpont');
    let count: number;
    if (item.kind === 'device') {
      reference(item.deviceId, deviceLookup, 'Vezetékvégpont készüléke');
      if (item.side !== 'top' && item.side !== 'bottom') fail('ismeretlen készülékoldal.');
      count = effectiveDevicePoles(deviceLookup.get(item.deviceId as string) as unknown as Device).length;
    } else if (item.kind === 'bus') {
      reference(item.busId, busLookup, 'Vezetékvégpont sínje');
      count = busLookup.get(item.busId as string)!.capacity as number;
    } else if (item.kind === 'infeed') {
      reference(item.infeedId, infeedLookup, 'Vezetékvégpont betáplálása');
      count = (infeedLookup.get(item.infeedId as string)!.poles as unknown[]).length;
    } else return fail('ismeretlen vezetékvégpont-típus.');
    const index = item.kind === 'bus' ? item.terminal : item.pole;
    finite(index, 'Kapocsszám', 10_000);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      fail('a vezetékvégpont kapocsszáma tartományon kívüli.');
  };
  for (const board of boardValues)
    if (board.wiring) {
      const wiring = board.wiring as JsonObject;
      for (const wire of wiring.wires as unknown[]) {
        object(wire, 'Vezeték');
        endpoint(wire.from);
        endpoint(wire.to);
        if (wire.color !== undefined) {
          text(wire.color, 'Vezetékszín', 100);
          if (!/^#[0-9a-fA-F]{6}$/.test(wire.color)) fail('a vezetékszín nem hatjegyű hexadecimális szín.');
        }
        if (wire.colorPattern !== undefined && wire.colorPattern !== 'green-yellow')
          fail('ismeretlen vezetékszínminta.');
        if (wire.label !== undefined) text(wire.label, 'Vezetékfelirat', 5000);
        cableDetails(wire.cable);
        if (wire.points !== undefined) {
          array(wire.points, 'Vezeték nyomvonalpontjai', 10_000);
          for (const entry of wire.points) {
            object(entry, 'Vezeték nyomvonalpontja');
            point(entry, 'Vezeték nyomvonalpontja');
          }
        }
        if (wire.labelOffset !== undefined) {
          object(wire.labelOffset, 'Vezetékfelirat eltolása');
          point(wire.labelOffset, 'Vezetékfelirat eltolása');
        }
      }
    }
}

function manufacturerSource(value: unknown) {
  text(value, 'Gyártói forrás', 5000);
  try {
    const source = new URL(value);
    if (source.protocol !== 'https:' || source.username || source.password || /[\u0000-\u0020\u007f]/.test(value))
      throw new Error();
  } catch {
    fail('a gyártói forrás kizárólag hitelesítés nélküli HTTPS-hivatkozás lehet.');
  }
}

function productSnapshot(value: unknown) {
  if (value === undefined) return;
  object(value, 'Termékadatok');
  for (const [key, label] of [
    ['reference', 'Termékazonosító'],
    ['manufacturer', 'Gyártó'],
    ['range', 'Termékcsalád'],
    ['sourceDocument', 'Forrásdokumentum']
  ] as const) {
    identifier(value[key], label);
  }
  manufacturerSource(value.sourceUrl);
  if (value.supplementalSourceUrl !== undefined) manufacturerSource(value.supplementalSourceUrl);
  finite(value.sourcePage, 'Forrásoldal');
  if (!Number.isInteger(value.sourcePage) || value.sourcePage <= 0)
    fail('a forrás oldalszáma pozitív egész szám legyen.');
  timestamp(value.verifiedAt, 'Ellenőrzés időpontja');
  text(value.mounting, 'Szerelési mód', 100);
  if (!['din', 'accessory', 'enclosure'].includes(value.mounting)) fail('ismeretlen termékszerelési mód.');
  if (value.description !== undefined) {
    object(value.description, 'Termékleírás');
    text(value.description.hu, 'Magyar termékleírás', 20_000);
    text(value.description.en, 'Angol termékleírás', 20_000);
  }
  for (const key of ['poles', 'curve', 'residualType', 'voltage'])
    if (value[key] !== undefined) text(value[key], `${t('Termékadatok')}.${key}`, 1000);
  for (const key of [
    'moduleWidth',
    'widthMm',
    'currentA',
    'breakingCapacityKa',
    'residualCurrentMa',
    'boardRows',
    'modulesPerRow'
  ]) {
    if (value[key] === undefined) continue;
    finite(value[key], `${t('Termékadatok')}.${key}`);
    if (value[key] <= 0) fail('a termék számszerű adata legyen pozitív.');
    if ((key === 'boardRows' || key === 'modulesPerRow') && !Number.isInteger(value[key]))
      fail('a termék sor- és modulkapacitása pozitív egész szám legyen.');
  }
}

function validateData(value: unknown, assets: ReadonlyMap<string, Asset>, projectId?: string) {
  object(value, 'Projektadatok');
  identifier(value.id, 'Projektazonosító');
  if (projectId && value.id !== projectId) fail('egy előzmény másik projekthez tartozik.');
  text(value.name, 'Projektnév', 1000);
  text(value.site, 'Helyszín', 5000);
  text(value.client, 'Megrendelő', 5000);
  text(value.notes, 'Projektjegyzet');
  if (value.floorPlanDisplay !== undefined && value.floorPlanDisplay !== 'symbols' && value.floorPlanDisplay !== 'images')
    fail('ismeretlen alaprajzi megjelenítés.');
  if (value.boardPlanner !== undefined && !isBoardPlannerSnapshot(value.boardPlanner))
    fail('az elosztóterv adatai hibásak vagy túl nagyok.');
  array(value.devices, 'Készülékek');
  array(value.circuits, 'Áramkörök');
  array(value.sheets, 'Tervlapok', 500);
  array(value.boards, 'Elosztók', 500);
  const devices = uniqueIds(value.devices, 'Készülék');
  const circuits = uniqueIds(value.circuits, 'Áramkör');
  uniqueIds(value.sheets, 'Tervlap');
  const boards = uniqueIds(value.boards, 'Elosztó');
  for (const entry of value.devices) {
    object(entry, 'Készülék');
    for (const key of ['code', 'name', 'room', 'model', 'notes']) text(entry[key], `${t('Készülék')}.${key}`);
    text(entry.kind, 'Készüléktípus');
    text(entry.status, 'Készülékállapot');
    if (!kinds.has(entry.kind) || !statuses.has(entry.status)) fail('ismeretlen készüléktípus vagy állapot.');
    if (entry.variant !== undefined && !isDeviceVariantForKind(entry.variant, entry.kind))
      fail('ismeretlen vagy nem megfelelő készülékváltozat.');
    finite(entry.heightMm, 'Szerelési magasság');
    if (entry.moduleWidth !== undefined) finite(entry.moduleWidth, 'Modulszélesség', 100_000);
    if (entry.rating !== undefined) text(entry.rating, 'Névleges adat');
    productSnapshot(entry.product);
    electrical(entry.electrical);
    reference(entry.boardId, boards, 'Készülék elosztója', true);
    if (entry.quantity !== undefined) {
      finite(entry.quantity, 'Darabszám', 1_000_000);
      if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) fail('a darabszám pozitív egész szám legyen.');
    }
    reference(entry.circuitId, circuits, 'Készülék áramköre', true);
    array(entry.photoIds, 'Készülékfotók', 1000);
    for (const photo of entry.photoIds) reference(photo, assets, 'Fotó');
    if (entry.planImage !== undefined) {
      object(entry.planImage, 'Alaprajzi kép');
      reference(entry.planImage.assetId, assets, 'Alaprajzi kép');
      if (!isPlanImageAsset(assets.get(entry.planImage.assetId as string)))
        fail('az alaprajzi kép PNG, JPG vagy WebP formátumú legyen.');
      finite(entry.planImage.size, 'Alaprajzi képméret', 240);
      if (entry.planImage.size < 24) fail('az alaprajzi képméret 24 és 240 közötti szám legyen.');
      finite(entry.planImage.opacity, 'Alaprajzi kép átlátszatlansága', 1);
      if (entry.planImage.opacity < 0.1) fail('az alaprajzi kép átlátszatlansága 0,1 és 1 közötti szám legyen.');
    }
  }
  for (const entry of value.circuits) {
    object(entry, 'Áramkör');
    for (const key of ['code', 'name', 'color', 'notes']) text(entry[key], `${t('Áramkör')}.${key}`);
    if (!/^#[0-9a-fA-F]{6}$/.test(entry.color as string)) fail('az áramkör színe nem hatjegyű hexadecimális szín.');
    reference(entry.protectionDeviceId, devices, 'Áramkör védelme', true);
    if (entry.cable !== undefined) text(entry.cable, 'Áramköri kábel', 5000);
    if (entry.powerW !== undefined) {
      finite(entry.powerW, 'Rögzített teljesítmény');
      if (entry.powerW < 0) fail('a rögzített teljesítmény nem lehet negatív.');
    }
    if (entry.loadType !== undefined && !['socket', 'lamp', 'motor', 'other'].includes(entry.loadType as string))
      fail('ismeretlen fogyasztótípus.');
    if (entry.phase !== undefined && !['L1', 'L2', 'L3'].includes(entry.phase as string)) fail('ismeretlen fázis.');
    cableDetails(entry.cableDetails);
  }
  for (const sheet of value.sheets) {
    object(sheet, 'Tervlap');
    text(sheet.name, 'Tervlap neve', 1000);
    finite(sheet.width, 'Tervlap szélessége');
    finite(sheet.height, 'Tervlap magassága');
    if (sheet.width <= 0 || sheet.height <= 0) fail('a tervlap mérete legyen pozitív.');
    if (sheet.mmPerUnit !== undefined) {
      finite(sheet.mmPerUnit, 'Méretarány');
      if (sheet.mmPerUnit <= 0) fail('a méretarány legyen pozitív.');
    }
    reference(sheet.backgroundAssetId, assets, 'Alaprajz', true);
    if (sheet.backgroundOpacity !== undefined) {
      finite(sheet.backgroundOpacity, 'Alaprajz fedettsége', 1);
      if (sheet.backgroundOpacity < 0) fail('az alaprajz fedettsége 0 és 1 közötti szám legyen.');
    }
    array(sheet.placements, 'Elhelyezések');
    if (sheet.boardPlacements !== undefined) {
      array(sheet.boardPlacements, 'Elosztók elhelyezése', 500);
      const placedBoards = new Set<string>();
      for (const placement of sheet.boardPlacements) {
        object(placement, 'Elosztó elhelyezése');
        reference(placement.boardId, boards, 'Elhelyezett elosztó');
        if (placedBoards.has(placement.boardId as string)) fail('egy elosztó ugyanazon a tervlapon kétszer szerepel.');
        placedBoards.add(placement.boardId as string);
        point(placement, 'Elosztó elhelyezése');
      }
    }
    array(sheet.routes, 'Kapcsolatok');
    array(sheet.annotations, 'Feliratok');
    const placed = new Set<string>();
    for (const placement of sheet.placements) {
      object(placement, 'Elhelyezés');
      reference(placement.deviceId, devices, 'Elhelyezett készülék');
      const deviceId = placement.deviceId as string;
      if (placed.has(deviceId)) fail('egy készülék ugyanazon a tervlapon kétszer szerepel.');
      placed.add(deviceId);
      point(placement, 'Elhelyezés');
      finite(placement.rotation, 'Forgatás');
    }
    uniqueIds(sheet.routes, 'Kapcsolat');
    for (const route of sheet.routes) {
      object(route, 'Kapcsolat');
      reference(route.fromDeviceId, devices, 'Kapcsolat kezdete');
      reference(route.toDeviceId, devices, 'Kapcsolat vége');
      reference(route.circuitId, circuits, 'Kapcsolat áramköre', true);
      if (route.kind !== 'power' && route.kind !== 'control') fail('ismeretlen kapcsolattípus.');
      array(route.points, 'Nyomvonalpontok', 10_000);
      for (const item of route.points) {
        object(item, 'Nyomvonalpont');
        point(item, 'Nyomvonalpont');
      }
    }
    uniqueIds(sheet.annotations, 'Felirat');
    for (const annotation of sheet.annotations) {
      object(annotation, 'Felirat');
      text(annotation.text, 'Felirat szövege');
      point(annotation, 'Felirat');
      if (annotation.kind !== undefined && annotation.kind !== 'text') fail('ismeretlen felirattípus.');
      if (annotation.fontSize !== undefined) {
        finite(annotation.fontSize, 'Felirat betűmérete', 120);
        if (annotation.fontSize < 6) fail('a felirat betűmérete 6 és 120 közötti szám legyen.');
      }
      if (annotation.color !== undefined) {
        text(annotation.color, 'Felirat színe', 7);
        if (!/^#[0-9a-fA-F]{6}$/.test(annotation.color)) fail('a felirat színe nem hatjegyű hexadecimális szín.');
      }
    }
  }
  for (const board of value.boards) {
    object(board, 'Elosztó');
    text(board.name, 'Elosztó neve', 1000);
    array(board.rows, 'Elosztósorok', 1000);
    uniqueIds(board.rows, 'Elosztósor');
    productSnapshot(board.product);
    if (board.supplyLabel !== undefined) text(board.supplyLabel, 'Betáplálás megnevezése', 5000);
    if (board.connections !== undefined) {
      array(board.connections, 'Elosztókapcsolatok');
      uniqueIds(board.connections, 'Elosztókapcsolat');
      for (const connection of board.connections) {
        object(connection, 'Elosztókapcsolat');
        reference(connection.fromDeviceId, devices, 'Elosztókapcsolat forrása', true);
        reference(connection.toDeviceId, devices, 'Elosztókapcsolat célja');
      }
    }
    for (const row of board.rows) {
      object(row, 'Elosztósor');
      text(row.name, 'Sor neve', 1000);
      finite(row.capacity, 'Sor kapacitása', 100_000);
      array(row.placements, 'Modulok');
      // Invalid layout geometry is a recoverable planning issue, not file
      // corruption. Preserve it so the editor can display the exact collision.
      for (const placement of row.placements) {
        object(placement, 'Modulhely');
        reference(placement.deviceId, devices, 'Modul készüléke');
        finite(placement.start, 'Modul kezdőpozíció', 100_000);
      }
    }
  }
  validateWiring(value, value.devices);
}

export function readProjectDocument(value: unknown, options: { collectAssetBytes?: boolean } = {}) {
  object(value, 'Projekt');
  if (value.schemaVersion !== 1)
    fail('nem támogatott formátumverzió. Frissítsd az alkalmazást, ha újabb programmal készült a fájl.');
  // Only ZIP creation retains decoded assets; validation can release each one.
  const { bytes: assetBytes } = readAssets(value.assets, options.collectAssetBytes);
  const assets = new Map(Object.entries(value.assets as Record<string, Asset>));
  validateData(value.data, assets);
  object(value.data, 'Projektadatok');
  const projectId = value.data.id as string;
  array(value.revisions, 'Előzmények', 2000);
  const revisionIds = uniqueIds(value.revisions, 'Változat');
  optionalId(value.headRevisionId, 'Aktuális változat');
  reference(value.headRevisionId, revisionIds, 'Aktuális változat', true);
  timestamp(value.updatedAt, 'Módosítás időpontja');
  if (value.lastExternalSaveAt !== undefined) timestamp(value.lastExternalSaveAt, 'Fájlmentés időpontja');
  if (value.lastDriveSaveAt !== undefined) timestamp(value.lastDriveSaveAt, 'Drive-mentés időpontja');
  const parents = new Map<string, string | undefined>();
  for (const revision of value.revisions) {
    object(revision, 'Változat');
    timestamp(revision.createdAt, 'Változat időpontja');
    text(revision.note, 'Változat megjegyzése');
    reference(revision.parentId, revisionIds, 'Előző változat', true);
    reference(revision.restoredFrom, revisionIds, 'Visszaállított változat', true);
    validateData(revision.data, assets, projectId);
    parents.set(revision.id as string, revision.parentId as string | undefined);
  }
  const checked = new Set<string>();
  for (const id of revisionIds) {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !checked.has(current)) {
      if (visited.has(current)) fail('körkörös előzményhivatkozás.');
      visited.add(current);
      current = parents.get(current);
    }
    for (const ancestor of visited) checked.add(ancestor);
  }
  return { document: value as unknown as ProjectDocument, assetBytes };
}

export function validateProject(value: unknown): asserts value is ProjectDocument {
  readProjectDocument(value);
}
