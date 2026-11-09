import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { makeDevice } from './catalog';
import { ARCHIVE_LIMITS, PROJECT_FILE_FORMAT, assetFromFile, decodeProject, encodeProject, validateProject } from './data/archive';
import { checkpoint, createProject, deleteDevice, resolveImport, restoreRevision } from './data/project';
import { createDemoProject } from './data/demo';
import { getBoardIssues } from './data/boardPlacement';
import { deleteProject, listProjects, loadProject, projectDatabase, saveProject } from './data/storage';
import { setLanguage } from './i18n';

afterEach(() => { setLanguage('hu'); });

describe('a projektadatok nyelve', () => {
  it('az új angol projektek és a mintaterv generált nevei angolok', () => {
    setLanguage('en');
    const blank = createProject();
    expect(blank.data.name).toBe('New project');
    expect(blank.data.sheets[0].name).toBe('Ground floor');
    expect(blank.data.boards[0].rows[0].name).toBe('Row 1');
    expect(createProject('Saját projektnév').data.name).toBe('Saját projektnév');
    const demo = createDemoProject();
    expect(demo.data.name).toBe('Riverside apartment');
    expect(demo.data.circuits[0].code).toBe('C1');
    expect(demo.data.devices[0].room).toBe('Living room');
    expect(demo.revisions[0].note).toBe('Initial sample plan');
    const background = Object.values(demo.assets)[0];
    expect(atob(background.data.split(',')[1])).toContain('LIVING ROOM');
  });

  it('a nyelvváltás és az export nem fordítja át a meglévő adatokat és előzményeket', async () => {
    const original = createDemoProject();
    original.data.devices[0].name = 'Saját felirat';
    original.data.notes = 'A felhasználó jegyzete';
    const before = structuredClone(original);
    setLanguage('en');
    const reopened = await decodeProject(await encodeProject(original));
    expect(reopened).toEqual(before);
    expect(original).toEqual(before);
    const restored = restoreRevision(original, original.headRevisionId!);
    expect(restored.revisions.at(-1)?.note).toBe('Restored: Kiinduló mintaterv');
    expect(restored.data.name).toBe('Dunaparti lakás');
    expect(original).toEqual(before);
  });

  it('angolul jelzi a fájlhibát és a modulütközést az adatok átírása nélkül', () => {
    const document = createProject();
    document.data.boards[0].rows[0].capacity = 0;
    const before = structuredClone(document);
    setLanguage('en');
    expect(getBoardIssues(document.data.boards[0], []).map(issue => issue.message)).toEqual(['1. sor: row capacity must be positive.']);
    expect(() => validateProject({ ...document, schemaVersion: 99 })).toThrow('Invalid project file: unsupported format version.');
    expect(() => validateProject({ ...document, data: { ...document.data, devices: null } })).toThrow('Devices is an invalid or excessively long list.');
    expect(document).toEqual(before);
  });
});

describe('projektelőzmények és import', () => {
  it('a checkpoint elkülöníti az új munkapéldányt és pillanatképet, az állandó előzményeket és mellékleteket megosztja', () => {
    const original = createDemoProject();
    const before = structuredClone(original);
    const saved = checkpoint(original, 'Új változat');
    expect(original).toEqual(before);
    expect(saved.assets).toBe(original.assets);
    expect(saved.revisions).not.toBe(original.revisions);
    expect(saved.revisions[0]).toBe(original.revisions[0]);
    expect(saved.data).not.toBe(original.data);
    const snapshot = saved.revisions.at(-1)!.data;
    expect(snapshot).not.toBe(original.data);
    expect(snapshot).not.toBe(saved.data);
    original.data.devices[0].name = 'Eredeti munkapéldány';
    saved.data.devices[0].name = 'Új munkapéldány';
    expect(snapshot.devices[0].name).toBe(before.data.devices[0].name);
    expect(saved.revisions[0].data).toEqual(before.revisions[0].data);
  });

  it('a mintaterv nyomvonalainak végei a kapcsolt készülékekhez illeszkednek', () => {
    const document = createDemoProject();
    for (const sheet of document.data.sheets) {
      for (const route of sheet.routes) {
        const from = sheet.placements.find(placement => placement.deviceId === route.fromDeviceId);
        const to = sheet.placements.find(placement => placement.deviceId === route.toDeviceId);
        expect(from).toBeDefined(); expect(to).toBeDefined();
        expect(route.points[0]).toEqual({ x: from!.x, y: from!.y });
        expect(route.points.at(-1)).toEqual({ x: to!.x, y: to!.y });
      }
    }
  });

  it('a visszaállítás új változatot hoz létre és megőrzi az elágazást', () => {
    const first = checkpoint(createProject('Lakás'), 'Első terv');
    first.data.site = 'Második helyszín';
    const second = checkpoint(first, 'Módosítás');
    const restored = restoreRevision(second, first.headRevisionId!);
    expect(restored.data.site).toBe('');
    expect(restored.revisions).toHaveLength(3);
    expect(restored.revisions[2].parentId).toBe(second.headRevisionId);
    expect(restored.revisions[2].restoredFrom).toBe(first.headRevisionId);
    expect(second.data.site).toBe('Második helyszín');
    restored.data.site = 'Új munkapéldány';
    expect(restored.revisions[2].data.site).toBe('');
  });

  it('az eltérő import külön azonosítót kap, minden előzményével együtt', () => {
    const local = checkpoint(createProject('Lakás'), 'Kiindulás');
    const incoming = structuredClone(local);
    incoming.data.client = 'Helyszínen módosítva';
    const imported = resolveImport(incoming, local).document;
    expect(imported.data.id).not.toBe(local.data.id);
    expect(imported.data.name).toContain('importált másolat');
    expect(imported.revisions.every(revision => revision.data.id === imported.data.id)).toBe(true);
    expect(local.data.client).toBe('');
    expect(incoming.data.id).toBe(local.data.id);
    validateProject(imported);
  });

  it('azonos tartalom esetén nem készít új projektet', () => {
    const local = createDemoProject();
    const incoming = structuredClone(local);
    incoming.lastExternalSaveAt = new Date().toISOString();
    expect(resolveImport(incoming, local).document.data.id).toBe(local.data.id);
  });

  it('a készülék törlése minden nézetből és védelmi hivatkozásból eltávolítja', () => {
    const document = createDemoProject();
    const circuit = document.data.circuits[0];
    const id = circuit.protectionDeviceId!;
    const next = deleteDevice(document.data, id);
    expect(next.devices.some(device => device.id === id)).toBe(false);
    expect(next.boards.flatMap(board => board.rows.flatMap(row => row.placements)).some(placement => placement.deviceId === id)).toBe(false);
    expect(next.circuits[0].protectionDeviceId).toBeUndefined();
    const routeId = document.data.sheets[0].routes[0].fromDeviceId!;
    const withoutSwitch = deleteDevice(document.data, routeId);
    expect(withoutSwitch.sheets[0].routes).toHaveLength(0);
    expect(withoutSwitch.sheets[0].placements.some(placement => placement.deviceId === routeId)).toBe(false);
    expect(document.data.sheets[0].routes).toHaveLength(1);
  });
});

describe('modulkiosztás', () => {
  it('does not report collisions caused only by six-decimal source rounding',()=>{
    const first=makeDevice('custom',[]),second=makeDevice('custom',[first]);first.moduleWidth=29/17.5;second.moduleWidth=29/17.5;
    const board={id:'b',name:'Imported terminals',rows:[{id:'r',name:'Row',capacity:18,placements:[{deviceId:first.id,start:4.971429},{deviceId:second.id,start:6.628571}]}]};
    expect(getBoardIssues(board,[first,second])).toEqual([]);
    board.rows[0].placements[1].start-=.01;expect(getBoardIssues(board,[first,second])).toHaveLength(1);
  });
  it('félmodulos készülékek egymás mellé helyezhetők', () => {
    const first = makeDevice('custom', []); first.moduleWidth = 0.5;
    const second = makeDevice('custom', [first]); second.moduleWidth = 1.5;
    const board = { id: 'b', name: 'Elosztó', rows: [{ id: 'r', name: 'Sor', capacity: 2, placements: [{ deviceId: first.id, start: 0 }, { deviceId: second.id, start: 0.5 }] }] };
    expect(getBoardIssues(board, [first, second])).toEqual([]);
    board.rows[0].placements[1].start = 0.25;
    expect(getBoardIssues(board, [first, second]).map(issue => issue.message).join(' ')).toContain('ütköző');
    board.rows[0].placements[1].start = 1;
    expect(getBoardIssues(board, [first, second]).map(issue => issue.message).join(' ')).toContain('túllóg');
  });

  it('hiányzó, kétszer elhelyezett és érvénytelen modulokat is jelez', () => {
    const device = makeDevice('breaker', []);
    const board = { id: 'b', name: 'Elosztó', rows: [{ id: 'r', name: 'Sor', capacity: 12, placements: [{ deviceId: device.id, start: -1 }, { deviceId: device.id, start: 0 }, { deviceId: 'missing', start: 3 }] }] };
    const issues = getBoardIssues(board, [device]);
    expect(issues).toHaveLength(3);
    expect(issues.every(issue => issue.rowId === 'r')).toBe(true);
  });
});

describe('hordozható archívum', () => {
  it('megtartja a képeket és a már csak előzményben hivatkozott fotót is', async () => {
    const original = createDemoProject();
    const photo = await assetFromFile(new File([new Uint8Array([137, 80, 78, 71])], 'helyszin.png', { type: 'image/png' }));
    original.assets[photo.id] = photo;
    original.data.devices[0].photoIds.push(photo.id);
    const saved = checkpoint(original, 'Helyszíni fotó');
    saved.data.devices[0].photoIds = [];
    const loaded = await decodeProject(await encodeProject(saved));
    expect(loaded).toEqual(saved);
    expect(loaded.revisions[1].data.devices[0].photoIds).toEqual([photo.id]);
    expect(loaded.assets[photo.id].data).toBe(photo.data);
  });

  it('a hibás belső hivatkozást és a körkörös előzményt elutasítja', async () => {
    const document = checkpoint(createProject(), 'Mentés');
    document.revisions[0].parentId = document.headRevisionId;
    await expect(encodeProject(document)).rejects.toThrow('körkörös');
    const nested = createDemoProject();
    nested.data.sheets[0].placements[0].deviceId = 'ismeretlen';
    expect(()=>validateProject(nested)).toThrow('hiányzó hivatkozás');
  });

  it('ismeretlen sémát és aktív SVG-mellékletet elutasít', async () => {
    await expect(encodeProject({ ...createProject(), schemaVersion: 99 } as never)).rejects.toThrow('nem támogatott formátumverzió');
    await expect(assetFromFile(new File(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], 'active.svg', { type: 'image/svg+xml' }))).rejects.toThrow('aktív');
  });

  it.each([
    '<script>alert(1)</script>',
    '<s:script xmlns:s="http://www.w3.org/2000/svg">alert(1)</s:script>',
    '<rect width="10" height="10" onload="alert(1)"/>',
    '<foreignObject><div>HTML</div></foreignObject>',
    '<image href="https://example.com/tracker.png"/>',
    '<image href="javascript:alert(1)"/>',
    '<image href="&#x68;ttps://example.com/tracker.png"/>',
    '<rect fill="&#x75;rl(https://example.com/paint.svg)"/>',
    '<rect fill="\\75rl(https://example.com/paint.svg)"/>',
    '<style>@import "https://example.com/style.css";</style>',
    '<set attributeName="href" to="https://example.com/tracker.png"/>',
  ])('rosszindulatú ZIP SVG-t is elutasít: %s', async content => {
    const document = createProject();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`;
    const manifest = { ...document, format:PROJECT_FILE_FORMAT, assets: { svg: { id: 'svg', name: 'import.svg', mime: 'image/svg+xml', path: 'assets/00001.bin' } } };
    const zip = zipSync({ 'project.json': strToU8(JSON.stringify(manifest)), 'assets/00001.bin': strToU8(svg) });
    await expect(decodeProject(new Blob([new Uint8Array(zip).buffer]))).rejects.toThrow('SVG aktív');
  });

  it('passzív SVG helyi festékhivatkozással és szöveggel importálható', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><text x="1" y="2">Áramkör</text></svg>';
    const asset = await assetFromFile(new File([svg], 'safe.svg', { type: 'image/svg+xml' }));
    const document = createProject(); document.assets[asset.id] = asset;
    const decoded = await decodeProject(await encodeProject(document));
    expect(decoded.assets[asset.id]).toEqual(asset);
  });

  it('kicsomagolás előtt korlátozza a ZIP méretét és fájlneveit', async () => {
    const bytes = zipSync({ 'project.json': strToU8('{}') });
    const view = new DataView(bytes.buffer);
    // Advertise a huge expanded file in its central directory. The actual
    // compressed payload stays tiny and should never be inflated.
    for (let offset = 0; offset < bytes.length - 24; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 24, ARCHIVE_LIMITS.jsonBytes + 1, true);
    }
    await expect(decodeProject(new Blob([new Uint8Array(bytes).buffer]))).rejects.toThrow('túl nagy');
    const traversal = zipSync({ '../project.json': strToU8('{}') });
    await expect(decodeProject(new Blob([new Uint8Array(traversal).buffer]))).rejects.toThrow('nem biztonságos ZIP-fájlnév');
  });

  it('a sérült és a hiányos mellékletes ZIP-et elutasítja', async () => {
    await expect(decodeProject(new Blob(['ez nem projekt']))).rejects.toThrow('ZIP sérült');
    const document = createProject();
    const incomplete = { ...document, format:PROJECT_FILE_FORMAT, assets: { image: { id: 'image', name: 'hianyzik.png', mime: 'image/png', path: 'assets/00001.bin' } } };
    const archive = zipSync({ 'project.json': strToU8(JSON.stringify(incomplete)) });
    await expect(decodeProject(new Blob([new Uint8Array(archive).buffer]))).rejects.toThrow('hiányzó vagy ismétlődő mellékletfájl');
  });

  it('ellenőrzi a ZIP-tartalom ellenőrző összegét is', async () => {
    const archive = zipSync({ 'project.json': strToU8(JSON.stringify(createProject())) }, { level: 0 });
    const view = new DataView(archive.buffer);
    for (let offset = 0; offset < archive.length - 20; offset++) {
      if (view.getUint32(offset, true) === 0x02014b50) view.setUint32(offset + 16, 0, true);
    }
    await expect(decodeProject(new Blob([new Uint8Array(archive).buffer]))).rejects.toThrow('ellenőrző összeg');
  });
});

describe('helyi adatbázis', () => {
  afterEach(async () => { await projectDatabase.projects.clear(); });
  it('újranyitás után visszaadja a teljes projektet, majd törölhető', async () => {
    const document = createDemoProject();
    await saveProject(document);
    document.data.name = 'Nem mentett változtatás';
    projectDatabase.close();
    await projectDatabase.open();
    const reopened = await loadProject(document.data.id);
    expect(reopened?.data.name).toBe('Dunaparti lakás');
    expect(reopened?.revisions).toHaveLength(1);
    expect(Object.keys(reopened!.assets)).toHaveLength(1);
    expect(await listProjects()).toEqual([{ id: document.data.id, name: 'Dunaparti lakás', site: document.data.site, updatedAt: document.updatedAt }]);
    await deleteProject(document.data.id);
    expect(await loadProject(document.data.id)).toBeUndefined();
  });
});
