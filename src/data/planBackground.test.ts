import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import { addPlanBackgrounds } from './planBackground';

const imported = (id: string) => ({
  sheet: { id, name: id, width: 1800, height: 1200, backgroundAssetId: id, placements: [], routes: [], annotations: [] },
  assets: [{ id, name: `${id}.png`, mime: 'image/png', data: 'data:image/png;base64,AA==' }]
});

describe('floor-plan background import', () => {
  it('fills the selected unused sheet, keeps its identity and adds subsequent PDF pages', () => {
    const original = createProject('Import');
    original.data.sheets[0].mmPerUnit = 10;
    const id = original.data.sheets[0].id;
    const result = addPlanBackgrounds(original, [imported('page1'), imported('page2')], id);
    expect(result.data.sheets).toHaveLength(2);
    expect(result.data.sheets[0]).toMatchObject({ id, name: 'page1', width: 1800, backgroundAssetId: 'page1' });
    expect(result.firstSheetId).toBe(id);
    expect(result.data.sheets[0].mmPerUnit).toBeUndefined();
    expect(Object.keys(result.assets)).toEqual(['page1', 'page2']);
    expect(original.data.sheets[0].backgroundAssetId).toBeUndefined();
  });

  it.each(['background', 'placements', 'board', 'annotations', 'routes'])('preserves a sheet with existing %s content', (content) => {
    const original = createProject('Existing');
    const sheet = original.data.sheets[0];
    if (content === 'background') sheet.backgroundAssetId = 'existing';
    if (content === 'placements') sheet.placements.push({ deviceId: 'd', x: 15, y: 30, rotation: 90 });
    if (content === 'board') sheet.boardPlacements = [{ boardId: original.data.boards[0].id, x: 45, y: 60 }];
    if (content === 'annotations') sheet.annotations.push({ id: 'n', text: 'Keep', x: 10, y: 20 });
    if (content === 'routes') sheet.routes.push({ id: 'r', fromDeviceId: 'a', toDeviceId: 'b', kind: 'power', points: [] });
    const result = addPlanBackgrounds(original, [imported('new')], sheet.id);
    expect(result.data.sheets[0]).toEqual(sheet);
    expect(result.data.sheets).toHaveLength(2);
    expect(result.firstSheetId).toBe('new');
  });
});
