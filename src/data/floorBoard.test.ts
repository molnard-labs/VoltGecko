import { describe, expect, it } from 'vitest';
import { decodeProject, encodeProject, validateProject } from './archive';
import { checkpoint, createProject, deleteBoard, restoreRevision } from './project';
import { translate } from '../i18n';

describe('floor-plan board locations', () => {
  it('round-trips board markers and preserves them in revisions when a board is removed', async () => {
    const doc = createProject('Board marker');
    const boardId = doc.data.boards[0].id;
    doc.data.sheets[0].boardPlacements = [{ boardId, x: 123, y: 456 }];
    const saved = checkpoint(doc, 'Before removal');
    const next = { ...saved, data: deleteBoard(saved.data, boardId) };
    const reopened = await decodeProject(await encodeProject(next));
    expect(reopened.data.sheets[0].boardPlacements).toEqual([]);
    const restored = restoreRevision(reopened, reopened.revisions[0].id);
    expect(restored.data.sheets[0].boardPlacements).toEqual([{ boardId, x:123, y:456 }]);
  });
  it('rejects missing and repeated board references while allowing legacy sheets', () => {
    const doc = createProject('Board marker validation');
    expect(() => validateProject(doc)).not.toThrow();
    doc.data.sheets[0].boardPlacements = [{boardId:'missing', x:1, y:2}];
    expect(() => validateProject(doc)).toThrow();
    const boardId = doc.data.boards[0].id;
    doc.data.sheets[0].boardPlacements = [{boardId, x:1, y:2}, {boardId, x:3, y:4}];
    expect(() => validateProject(doc)).toThrow();
  });
  it('translates board placement and navigation labels in English', () => {
    expect(translate('en', 'Elosztó elhelyezése')).toBe('Place distribution board');
    expect(translate('en', 'Elhelyezendő elosztó')).toBe('Distribution board to place');
    expect(translate('en', 'Elosztó megnyitása: {name}', {name:'Workshop'})).toBe('Open distribution board: Workshop');
  });
});
