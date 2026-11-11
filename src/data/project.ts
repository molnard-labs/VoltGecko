import { uid } from '../catalog';
import { t } from '../i18n';
import type { ProjectData, ProjectDocument } from '../types';
import { pruneInvalidBoardRouteTerminals } from './boardRouteConnections';

export function createProject(name = t('Új projekt')): ProjectDocument {
  return {
    schemaVersion: 1,
    data: {
      id: uid(),
      name,
      site: '',
      client: '',
      notes: '',
      devices: [],
      circuits: [],
      sheets: [
        { id: uid(), name: t('Földszint'), width: 1200, height: 800, placements: [], routes: [], annotations: [] }
      ],
      boards: [
        { id: uid(), name: t('Lakáselosztó'), rows: [{ id: uid(), name: t('1. sor'), capacity: 12, placements: [] }] }
      ]
    },
    assets: {},
    revisions: [],
    updatedAt: new Date().toISOString()
  };
}

export function checkpoint(document: ProjectDocument, note = ''): ProjectDocument {
  const createdAt = new Date().toISOString();
  const revision = {
    id: uid(),
    parentId: document.headRevisionId,
    createdAt,
    note: note.trim() || t('Mentett változat'),
    data: structuredClone(document.data)
  };
  // Existing assets and snapshots are immutable; only the working data and new
  // snapshot need independent copies, regardless of the project's history size.
  return {
    ...document,
    data: structuredClone(document.data),
    revisions: [...document.revisions, revision],
    headRevisionId: revision.id,
    updatedAt: createdAt
  };
}

export function restoreRevision(document: ProjectDocument, revisionId: string): ProjectDocument {
  const original = document.revisions.find((revision) => revision.id === revisionId);
  if (!original) throw new Error(t('Ez a változat nem található a projekt előzményeiben.'));
  const next = checkpoint(
    { ...document, data: original.data },
    t('Visszaállítás: {note}', { note: original.note })
  );
  next.revisions[next.revisions.length - 1].restoredFrom = revisionId;
  return next;
}

export function deleteDevice(data: ProjectData, id: string): ProjectData {
  const next = structuredClone(data);
  next.devices = next.devices.filter((device) => device.id !== id);
  for (const sheet of next.sheets) {
    sheet.placements = sheet.placements.filter((placement) => placement.deviceId !== id);
    sheet.routes = sheet.routes.filter((route) => route.fromDeviceId !== id && route.toDeviceId !== id);
  }
  for (const board of next.boards) {
    for (const row of board.rows) row.placements = row.placements.filter((placement) => placement.deviceId !== id);
    if (board.connections)
      board.connections = board.connections.filter(
        (connection) => connection.fromDeviceId !== id && connection.toDeviceId !== id
      );
    if (board.wiring)
      board.wiring.wires = board.wiring.wires.filter(
        (wire) => ![wire.from, wire.to].some((endpoint) => endpoint.kind === 'device' && endpoint.deviceId === id)
      );
  }
  for (const circuit of next.circuits) {
    if (circuit.protectionDeviceId === id) delete circuit.protectionDeviceId;
  }
  return pruneInvalidBoardRouteTerminals(next);
}

/** Remove a board while retaining its devices and all links with valid endpoints. */
export function deleteBoard(data: ProjectData, id: string): ProjectData {
  const board = data.boards.find((item) => item.id === id);
  if (!board) return data;
  const buses = new Set(board.wiring?.buses.map((bus) => bus.id) ?? []);
  const infeeds = new Set(board.wiring?.infeeds.map((infeed) => infeed.id) ?? []);
  const next = structuredClone(data);
  next.boards = next.boards.filter((item) => item.id !== id);
  for (const sheet of next.sheets) {
    if (sheet.boardPlacements) sheet.boardPlacements = sheet.boardPlacements.filter((placement) => placement.boardId !== id);
    sheet.routes = sheet.routes.filter(route => route.fromBoardId !== id && route.toBoardId !== id);
  }
  for (const device of next.devices) if (device.boardId === id) delete device.boardId;
  for (const other of next.boards) {
    if (other.wiring) other.wiring.wires = other.wiring.wires.filter((wire) =>
      ![wire.from, wire.to].some((endpoint) =>
        endpoint.kind === 'bus' ? buses.has(endpoint.busId) : endpoint.kind === 'infeed' && infeeds.has(endpoint.infeedId)
      )
    );
  }
  return pruneInvalidBoardRouteTerminals(next);
}

export function resolveImport(
  incoming: ProjectDocument,
  existing?: ProjectDocument
): { document: ProjectDocument; message: string } {
  const document = structuredClone(incoming);
  if (!existing || existing.data.id !== incoming.data.id) {
    return { document, message: t('Projekt megnyitva. A helyi automatikus mentés bekapcsolva.') };
  }
  const content = (value: ProjectDocument) =>
    JSON.stringify({ data: value.data, assets: value.assets, revisions: value.revisions, head: value.headRevisionId });
  if (content(existing) === content(incoming)) {
    return {
      document: structuredClone(existing),
      message: t('Ez a projektváltozat már megtalálható ezen az eszközön.')
    };
  }
  // A file can represent a branch or unsaved working state, not just a named
  // checkpoint. Keeping a new identity avoids ever replacing either copy.
  const id = uid();
  document.data.id = id;
  document.data.name = t('{name} – importált másolat', { name: document.data.name });
  for (const revision of document.revisions) revision.data.id = id;
  document.updatedAt = new Date().toISOString();
  return {
    document,
    message: t(
      'Eltérő helyi változat található. Az import külön projektmásolatként nyílt meg; mindkét változat megmaradt.'
    )
  };
}
