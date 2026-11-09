import { t } from '../i18n';
import type { Board, ProjectData } from '../types';
import type { WiringIssue } from './boardWiring';

// These exact products have manufacturer-documented layouts that the current
// symmetric top/bottom terminal model cannot faithfully depict.
const schematicReferences = new Set([
  'EZ9L33620', 'EZ9L33720', 'EZ9L33745',
  'EZ9D55710', 'EZ9D55713', 'EZ9D55716', 'EZ9D55720', 'EZ9D55725'
]);

/** Report physical-terminal limitations without changing stored wire identities. */
export function getBoardTerminalWarnings(data: ProjectData, board: Board): WiringIssue[] {
  const ids = new Set(board.rows.flatMap(row => row.placements.map(placement => placement.deviceId)));
  for (const device of data.devices) if (device.boardId === board.id) ids.add(device.id);
  const issues: WiringIssue[] = [];
  for (const device of data.devices) {
    const product = device.product;
    if (!ids.has(device.id) || product?.manufacturer !== 'Schneider Electric') continue;
    if (schematicReferences.has(product.reference)) {
      issues.push({ code:'schematic-terminals', severity:'warning', deviceId:device.id,
        message:t('{code}: A csatlakozók rajza sematikus; a tényleges kapcsok eltérhetnek. A gyártó bekötési rajza az irányadó.', { code: device.code }) });
    }
    const count = product.poles?.replace(/\s/g, '').toUpperCase();
    if (/^(EZ9F|EZ9S)/.test(product.reference) && (count === '2P' || count === '4P')) {
      issues.push({ code:'unassigned-terminal-roles', severity:'warning', deviceId:device.id,
        message:t('{code}: A gyártó nem jelöl ki N-pólust; a beállított vezetőszerepeket ellenőrizd.', { code: device.code }) });
    }
  }
  return issues;
}
