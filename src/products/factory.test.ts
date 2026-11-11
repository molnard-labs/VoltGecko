import { afterEach, describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { decodeProject, encodeProject, validateProject } from '../data/archive';
import { checkpoint, createProject, restoreRevision } from '../data/project';
import { getBoardIssues } from '../data/boardPlacement';
import { setLanguage } from '../i18n';
import { addFloorProductToProject, addProductToProject, assignFloorProduct, canAssignFloorProduct, createDeviceFromProduct } from './factory';
import type { CatalogProduct } from './types';

// Deliberately fictional references: these tests exercise behavior, not manufacturer facts.
const fixture = (overrides: Partial<CatalogProduct> = {}): CatalogProduct => ({
  reference: 'TEST-MCB', manufacturer: 'Test manufacturer', range: 'Test range', category: 'mcb',
  kind: 'breaker', mounting: 'din', name: { hu: 'Teszt kismegszakító', en: 'Test circuit breaker' },
  description: { hu: 'Tesztadat', en: 'Test fixture' }, moduleWidth: 1, widthMm: 18,
  poles: '1P', currentA: 16, curve: 'C', breakingCapacityKa: 6, voltage: '230 V',
  sourceUrl: 'https://example.com/test-catalog.pdf', sourceDocument: 'Fictional test catalog',
  sourcePage: 10, verifiedAt: '2026-10-16', ...overrides,
});
afterEach(() => setLanguage('hu'));

describe('manufacturer product snapshots', () => {
  it('copies localized product details and stable device codes without linking the catalog object', () => {
    const product = fixture({ residualType: 'A', residualCurrentMa: 30 });
    setLanguage('en');
    const first = createDeviceFromProduct(product, [], 'board-id');
    const second = createDeviceFromProduct(product, [first], 'board-id');
    expect(first.name).toBe('Test circuit breaker');
    expect(first.model).toBe('Test manufacturer TEST-MCB');
    expect(first.rating).toBe('1P · C16 A · 6 kA · A · 30 mA · 230 V');
    expect(first.code).toBe('QF1'); expect(second.code).toBe('QF2');
    expect(first.moduleWidth).toBe(1); expect(first.boardId).toBe('board-id');
    product.reference = 'CHANGED'; product.moduleWidth = 2; product.name.en = 'Changed';
    product.description.en = 'Changed manufacturer facts';
    setLanguage('hu');
    expect(first.product?.reference).toBe('TEST-MCB'); expect(first.product?.moduleWidth).toBe(1);
    expect(first.name).toBe('Test circuit breaker');
    expect(first.product?.description).toEqual({ hu: 'Tesztadat', en: 'Test fixture' });
    expect(createDeviceFromProduct(fixture(), []).name).toBe('Teszt kismegszakító');
  });

  it.each([undefined, 0, -1, NaN, Infinity])('never substitutes a generic module width for unverified width %s', moduleWidth => {
    expect(() => createDeviceFromProduct(fixture({ moduleWidth }), [])).toThrow('ellenőrzött gyártói modulszélesség');
  });

  it('requires a documented and dated source before creating a catalog device', () => {
    expect(() => createDeviceFromProduct(fixture({ verifiedAt: '' }), [])).toThrow('forrása');
    expect(() => createDeviceFromProduct(fixture({ sourceUrl: 'javascript:alert(1)' }), [])).toThrow('forrása');
    expect(() => createDeviceFromProduct(fixture({ supplementalSourceUrl: 'javascript:alert(1)' }), [])).toThrow('forrása');
  });
});

describe('assigning a product to an existing floor device', () => {
  const product = (overrides: Partial<CatalogProduct> = {}) => fixture({
    reference: 'TEST-106', category: 'floor-switch', mounting: 'floor', kind: 'switch',
    variant: 'switch-two-way', moduleWidth: undefined, ...overrides,
  });

  it('updates only manufacturer data, preserves the original and archives the selection', async () => {
    const doc = createProject();
    const device = makeDevice('switch', [], 'switch-two-way');
    Object.assign(device, { name: 'Kitchen', room: 'Kitchen', notes: 'Do not move', circuitId: 'c1', model: 'Old model', rating: 'Custom rating', heightMm: 1234, status: 'installed' });
    doc.data.devices.push(device);
    doc.data.circuits.push({ id: 'c1', code: 'C1', name: 'Kitchen', color: '#123456', notes: '' });
    doc.data.sheets[0].placements.push({ deviceId: device.id, x: 12, y: 34, rotation: 90 });
    const before = structuredClone(doc.data);
    const chosen = product();
    const updated = assignFloorProduct(device, chosen);
    expect(device).toEqual(before.devices[0]);
    expect(updated).toEqual({ ...device, model: 'Test manufacturer TEST-106', product: expect.objectContaining({ reference: 'TEST-106', mounting: 'floor' }) });
    chosen.description.hu = 'Changed after selection';
    expect(updated.product?.description?.hu).toBe('Tesztadat');
    doc.data.devices[0] = updated;
    const saved = await decodeProject(await encodeProject(doc));
    expect(saved.data.sheets).toEqual(before.sheets);
    expect(saved.data.circuits).toEqual(before.circuits);
    expect(saved.data.devices[0]).toEqual(updated);
  });

  it('rejects incompatible devices, functions, accessories and unverified sources', () => {
    const twoWay = makeDevice('switch', [], 'switch-two-way');
    expect(canAssignFloorProduct(twoWay, product())).toBe(true);
    expect(canAssignFloorProduct(twoWay, product({ variant: undefined }))).toBe(false);
    expect(canAssignFloorProduct(twoWay, product({ variant: 'switch-intermediate' }))).toBe(false);
    expect(canAssignFloorProduct(makeDevice('outlet', []), product())).toBe(false);
    expect(canAssignFloorProduct(twoWay, product({ category: 'floor-accessory' }))).toBe(false);
    expect(canAssignFloorProduct(twoWay, product({ mounting: 'din' }))).toBe(false);
    expect(() => assignFloorProduct(twoWay, product({ variant: undefined }))).toThrow('nem felel meg');
    expect(() => assignFloorProduct(twoWay, product({ sourceUrl: 'javascript:invalid' }))).toThrow('forrása');
  });

  it('matches single sockets and push buttons across non-topological options, but not different functions', () => {
    const socket = makeDevice('outlet', []);
    const weatherproof = product({ kind: 'outlet', category: 'floor-outlet', variant: 'outlet-weatherproof' });
    expect(canAssignFloorProduct(socket, weatherproof)).toBe(true);
    expect(canAssignFloorProduct(makeDevice('outlet', [], 'outlet-weatherproof'), { ...weatherproof, variant: undefined })).toBe(true);
    expect(canAssignFloorProduct(socket, { ...weatherproof, variant: 'outlet-double' })).toBe(false);
    const button = makeDevice('switch', [], 'switch-push-button');
    expect(canAssignFloorProduct(button, product({ variant: 'switch-push-button-lit' }))).toBe(true);
    expect(canAssignFloorProduct(button, product({ variant: 'switch-push-button', name: { hu: 'Kettős nyomó', en: 'Double push button' } }))).toBe(false);
    expect(canAssignFloorProduct(button, product({ variant: 'switch-push-button', name: { hu: 'Redőnynyomó', en: 'Shutter button' } }))).toBe(false);
    const standardSwitch = makeDevice('switch', []);
    for (const name of ['Hármas kapcsoló', 'Kártyás kapcsoló', 'Redőnykapcsoló']) {
      expect(canAssignFloorProduct(standardSwitch, product({ variant: undefined, name: { hu: name, en: name } }))).toBe(false);
    }
    expect(canAssignFloorProduct(makeDevice('custom', []), product({ kind: 'custom', category: 'floor-data', variant: undefined }))).toBe(false);
    const data = makeDevice('custom', [], 'custom-data');
    const dataProduct = product({ kind: 'custom', category: 'floor-data', variant: 'custom-data', name: { hu: 'RJ45 aljzat', en: 'RJ45 socket' } });
    expect(canAssignFloorProduct(data, dataProduct)).toBe(true);
    expect(canAssignFloorProduct(data, { ...dataProduct, name: { hu: 'HDMI aljzat', en: 'HDMI socket' } })).toBe(false);
    expect(canAssignFloorProduct(data, { ...dataProduct, name: { hu: 'Optikai csatlakozó', en: 'Optical connection' } })).toBe(false);
    const tv = makeDevice('custom', [], 'custom-tv');
    const tvProduct = product({ kind: 'custom', category: 'floor-data', variant: 'custom-tv', name: { hu: 'TV/SAT aljzat', en: 'TV/SAT socket' } });
    expect(canAssignFloorProduct(tv, tvProduct)).toBe(true);
    expect(canAssignFloorProduct(tv, { ...tvProduct, name: { hu: 'SAT aljzat', en: 'SAT socket' } })).toBe(false);
  });
});

describe('adding catalog products to distribution boards', () => {
  it('uses the actual five-module RCBO width and scans rows of the active board only', () => {
    const original = createProject().data;
    original.boards[0].rows[0].capacity = 4;
    const active = { id: 'active', name: 'Active board', rows: [
      { id: 'full', name: 'Full', capacity: 4, placements: [] },
      { id: 'free', name: 'Free', capacity: 12, placements: [] },
    ] };
    original.boards.push(active);
    const before = structuredClone(original);
    const result = addProductToProject(original, fixture({ kind: 'rcbo', category: 'rcbo', moduleWidth: 5, poles: '3P+N' }), active.id);
    expect(result.placed).toBe(true); expect(result.boardId).toBe(active.id);
    expect(result.data.devices[0].moduleWidth).toBe(5);
    expect(result.data.boards[1].rows[1].placements).toEqual([{ deviceId: result.selectedId, start: 0 }]);
    expect(result.data.boards[0].rows[0].placements).toEqual([]);
    expect(getBoardIssues(result.data.boards[1], result.data.devices)).toEqual([]);
    expect(original).toEqual(before);
  });

  it('places half-module auxiliaries into the first available half-module gap', () => {
    const data = createProject().data;
    const occupied = makeDevice('custom', []); occupied.moduleWidth = 0.5;
    data.devices.push(occupied);
    data.boards[0].rows[0].placements.push({ deviceId: occupied.id, start: 0 });
    const result = addProductToProject(data, fixture({ category: 'control', kind: 'custom', moduleWidth: 0.5 }));
    expect(result.data.boards[0].rows[0].placements[1]).toEqual({ deviceId: result.selectedId, start: 0.5 });
    expect(getBoardIssues(result.data.boards[0], result.data.devices)).toEqual([]);
  });

  it('fits catalog devices immediately after exact fractional widths without half-module rounding', () => {
    const data = createProject().data;
    const occupied = makeDevice('custom', []); occupied.moduleWidth = 0.75;
    data.devices.push(occupied);
    data.boards[0].rows[0].capacity = 1.25;
    data.boards[0].rows[0].placements.push({ deviceId: occupied.id, start: 0 });
    const result = addProductToProject(data, fixture({ moduleWidth: 0.5 }));
    expect(result.placed).toBe(true);
    expect(result.data.boards[0].rows[0].placements[1]).toEqual({ deviceId: result.selectedId, start: 0.75 });
    expect(getBoardIssues(result.data.boards[0], result.data.devices)).toEqual([]);
  });

  it('retains an oversized device unplaced without increasing capacity or using another board', () => {
    const data = createProject().data;
    data.boards[0].rows[0].capacity = 2;
    data.boards.push({ id: 'other', name: 'Other', rows: [{ id: 'large', name: 'Large', capacity: 100, placements: [] }] });
    const result = addProductToProject(data, fixture({ moduleWidth: 5 }), data.boards[0].id);
    expect(result.placed).toBe(false); expect(result.data.devices).toHaveLength(1);
    expect(result.data.devices[0].boardId).toBe(data.boards[0].id);
    expect(result.data.boards[0].rows[0].capacity).toBe(2);
    expect(result.data.boards.flatMap(board => board.rows.flatMap(row => row.placements))).toEqual([]);
  });

  it('assigns accessories to the bill of materials with quantity one and no DIN occupancy', () => {
    const result = addProductToProject(createProject().data, fixture({ mounting: 'accessory', category: 'accessory', kind: 'custom', moduleWidth: undefined, currentA: 63 }));
    const device = result.data.devices[0];
    expect(result.placed).toBe(true); expect(device.quantity).toBe(1);
    expect(device.boardId).toBe(result.boardId); expect(device.moduleWidth).toBeUndefined();
    expect(device.product?.mounting).toBe('accessory'); expect(device.rating).toContain('63 A');
    expect(result.data.boards[0].rows[0].placements).toEqual([]);
  });

  it('creates an enclosure with exact manufacturer row capacities and source snapshot', () => {
    const original = createProject().data;
    const result = addProductToProject(original, fixture({ mounting: 'enclosure', category: 'enclosure', kind: 'custom', moduleWidth: undefined, boardRows: 3, modulesPerRow: 18, reference: 'TEST-BOX' }));
    const board = result.data.boards.find(item => item.id === result.boardId)!;
    expect(result.selectedId).toBeNull(); expect(result.placed).toBe(true);
    expect(result.data.devices).toEqual([]); expect(board.name).toContain('TEST-BOX');
    expect(board.rows.map(row => row.capacity)).toEqual([18, 18, 18]);
    expect(board.product?.reference).toBe('TEST-BOX'); expect(board.product?.boardRows).toBe(3);
    expect(board.product?.modulesPerRow).toBe(18); expect(original.boards).toHaveLength(1);
    expect(() => addProductToProject(original, fixture({ mounting: 'enclosure' }))).toThrow('sor- és modulkapacitás');
  });

  it('creates a localized twelve-module row when no board exists', () => {
    const original = createProject().data; original.boards = [];
    setLanguage('en');
    const result = addProductToProject(original, fixture());
    expect(result.data.boards).toHaveLength(1);
    expect(result.data.boards[0].name).toBe('Distribution board');
    expect(result.data.boards[0].rows[0].name).toBe('Row 1');
    expect(result.data.boards[0].rows[0].capacity).toBe(12);
    expect(result.placed).toBe(true); expect(original.boards).toEqual([]);
  });
});

describe('catalog project archive compatibility', () => {
  it('places a manufacturer floor product with its actual variant and preserves it in project files and history', async () => {
    let document = createProject();
    const before = structuredClone(document.data);
    const product = fixture({
      reference: 'TEST-TWO-WAY', category: 'floor-switch', mounting: 'floor', kind: 'switch',
      variant: 'switch-two-way', moduleWidth: undefined,
    });
    const sheetId = document.data.sheets[0].id;
    const result = addFloorProductToProject(document.data, product, sheetId, { x: 120, y: 200 });
    expect(document.data).toEqual(before);
    const device = result.data.devices.find(item => item.id === result.selectedId)!;
    expect(device.variant).toBe('switch-two-way');
    expect(device.product?.reference).toBe('TEST-TWO-WAY');
    expect(device.product?.mounting).toBe('floor');
    expect(device.boardId).toBeUndefined();
    expect(device.moduleWidth).toBeUndefined();
    expect(result.data.sheets[0].placements).toContainEqual({ deviceId: device.id, x: 120, y: 200, rotation: 0 });
    expect(() => addProductToProject(document.data, product)).toThrow();
    expect(() => addFloorProductToProject(document.data, { ...product, category: 'floor-accessory' }, sheetId, { x: 0, y: 0 })).toThrow();
    document.data = result.data;
    document = checkpoint(document, 'Floor product');
    const loaded = await decodeProject(await encodeProject(document));
    expect(loaded).toEqual(document);
    expect(restoreRevision(loaded, loaded.headRevisionId!).data.devices[0].variant).toBe('switch-two-way');
  });

  it('round-trips full product, enclosure and accessory metadata through files and history', async () => {
    let document = createProject();
    document.data = addProductToProject(document.data, fixture({ mounting: 'enclosure', category: 'enclosure', boardRows: 2, modulesPerRow: 18 })).data;
    const boardId = document.data.boards.at(-1)!.id;
    document.data = addProductToProject(document.data, fixture({ mounting: 'accessory', category: 'accessory', moduleWidth: undefined }), boardId).data;
    document.data.devices[0].quantity = 4;
    document = checkpoint(document, 'Catalog assembly');
    document.data.devices[0].quantity = 7;
    const loaded = await decodeProject(await encodeProject(document));
    expect(loaded).toEqual(document);
    const restored = restoreRevision(loaded, loaded.headRevisionId!);
    expect(restored.data.devices[0].quantity).toBe(4);
    expect(restored.data.devices[0].product?.sourceUrl).toBe('https://example.com/test-catalog.pdf');
    expect(restored.data.boards.at(-1)?.product?.modulesPerRow).toBe(18);
  });

  it('accepts existing schema-v1 projects with no catalog fields', () => {
    const document = createProject(); document.data.devices.push(makeDevice('breaker', []));
    expect(() => validateProject(document)).not.toThrow();
  });

  it.each(['javascript:alert(1)', 'http://example.com/test.pdf', 'data:text/html,unsafe', 'https://user:password@example.com/test.pdf', 'https://example.com/\ntracker'])('rejects unsafe product source URLs: %s', sourceUrl => {
    const document = createProject();
    document.data = addProductToProject(document.data, fixture()).data;
    document.data.devices[0].product!.sourceUrl = sourceUrl;
    expect(() => validateProject(document)).toThrow('HTTPS');
  });

  it('validates sources inside saved histories and enclosure snapshots too', () => {
    let document = createProject(); document.data = addProductToProject(document.data, fixture()).data;
    document = checkpoint(document);
    document.revisions[0].data.devices[0].product!.sourceUrl = 'javascript:alert(1)';
    expect(() => validateProject(document)).toThrow('HTTPS');
    document = createProject();
    document.data = addProductToProject(document.data, fixture({ mounting: 'enclosure', boardRows: 1, modulesPerRow: 12 })).data;
    document.data.boards.at(-1)!.product!.sourceUrl = 'http://example.com/';
    expect(() => validateProject(document)).toThrow('HTTPS');
  });

  it('round-trips and validates optional supplementary manufacturer URLs in devices and history', async () => {
    const supplementalSourceUrl = 'https://example.com/verified-product';
    let document = createProject();
    document.data = addProductToProject(document.data, fixture({ supplementalSourceUrl })).data;
    document = checkpoint(document);
    const loaded = await decodeProject(await encodeProject(document));
    expect(loaded.data.devices[0].product?.supplementalSourceUrl).toBe(supplementalSourceUrl);
    expect(loaded.revisions[0].data.devices[0].product?.supplementalSourceUrl).toBe(supplementalSourceUrl);
    for (const unsafe of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com']) {
      loaded.revisions[0].data.devices[0].product!.supplementalSourceUrl = unsafe;
      expect(() => validateProject(loaded)).toThrow('HTTPS');
    }
  });

  it('rejects orphan board references and nonpositive accessory quantities', () => {
    const document = createProject(); document.data = addProductToProject(document.data, fixture()).data;
    document.data.devices[0].boardId = 'missing-board';
    expect(() => validateProject(document)).toThrow('hiányzó hivatkozás');
    document.data.devices[0].boardId = document.data.boards[0].id;
    document.data.devices[0].quantity = 0;
    expect(() => validateProject(document)).toThrow('darabszám');
    document.data.devices[0].quantity = 1.5;
    expect(() => validateProject(document)).toThrow('darabszám');
  });

  it('validates both optional snapshot description languages and preserves older snapshots', () => {
    const document = createProject(); document.data = addProductToProject(document.data, fixture()).data;
    expect(() => validateProject(document)).not.toThrow();
    (document.data.devices[0].product!.description as unknown as { en: unknown }).en = 42;
    expect(() => validateProject(document)).toThrow('hibás szöveg');
    delete document.data.devices[0].product!.description;
    expect(() => validateProject(document)).not.toThrow();
  });
});
