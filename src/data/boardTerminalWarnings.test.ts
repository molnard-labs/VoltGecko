import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import { createProject } from './project';
import { createDeviceFromProduct } from '../products/factory';
import { SCHNEIDER_PRODUCTS } from '../products/schneider';
import { getBoardTerminalWarnings } from './boardTerminalWarnings';
import { getWiringIssues } from './boardWiring';

describe('manufacturer terminal warnings', () => {
  it('reports schematic SPD and 3P+N RCBO terminals for the board, but not 2P RCCB', () => {
    const { data } = createProject('Warnings');
    const [board] = data.boards;
    for (const sku of ['EZ9L33620', 'EZ9L33745', 'EZ9D55716', 'EZ9R49240']) {
      const product = SCHNEIDER_PRODUCTS.find(item => item.reference === sku)!;
      const device = createDeviceFromProduct(product, data.devices, board.id);
      data.devices.push(device);
    }
    const issues = getBoardTerminalWarnings(data, board);
    expect(issues.filter(issue => issue.code === 'schematic-terminals')).toHaveLength(3);
    expect(getWiringIssues(data, board).filter(issue => issue.code === 'schematic-terminals')).toHaveLength(3);
    expect(issues.some(issue => issue.deviceId === data.devices[3].id)).toBe(false);
  });

  it('reports 2P/4P MCB and switch roles even when pole data has been stored', () => {
    const { data } = createProject('Warnings');
    const [board] = data.boards;
    const mcb = createDeviceFromProduct(SCHNEIDER_PRODUCTS.find(item => item.reference === 'EZ9F57216')!, [], board.id);
    const isolator = createDeviceFromProduct(SCHNEIDER_PRODUCTS.find(item => item.reference === 'EZ9S16440')!, [mcb], board.id);
    const other = { ...makeDevice('breaker', []), boardId:'other' };
    data.devices.push(mcb, isolator, other);
    expect(getBoardTerminalWarnings(data, board).filter(issue => issue.code === 'unassigned-terminal-roles')).toHaveLength(2);
    mcb.electrical = { poles:['L', 'N'] };
    const remaining = getBoardTerminalWarnings(data, board).filter(issue => issue.code === 'unassigned-terminal-roles');
    expect(remaining).toHaveLength(2);
    expect(remaining.map(issue => issue.deviceId)).toEqual([mcb.id, isolator.id]);
  });
});
