import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardMarkerGraphic } from '../components/BoardMarkerGraphic';
import { createProject } from '../data/project';
import { getPlanSheetBounds } from '../data/planAppearance';
import { addProductToProject } from './factory';
import { SCHNEIDER_PRODUCTS } from './schneider';
import { boardImage } from './boardImage';

describe('floor plan enclosure photos', () => {
  it('resolves catalog photos from saved product snapshots and falls back for an unknown board', () => {
    const product = SCHNEIDER_PRODUCTS.find(item => item.reference === 'EZ9EUD212')!;
    const project = createProject();
    const result = addProductToProject(project.data, product);
    const board = result.data.boards.find(item => item.id === result.boardId)!;
    expect(boardImage(board)?.src).toBe(product.image);
    expect(boardImage({ product: { ...board.product!, manufacturer: 'Other' } })).toBeUndefined();
    const render = (value: typeof board, display: 'images' | 'symbols') => renderToStaticMarkup(createElement('svg', null, createElement(BoardMarkerGraphic, { board: value, display, selected: false })));
    const photo = render(board, 'images');
    expect(photo).toContain('<image');
    const symbol = render(board, 'symbols');
    expect(symbol).not.toContain('<image');
    expect(render(project.data.boards[0], 'images')).not.toContain('<image');
  });

  it('includes a catalogue board image beyond the page in fitted bounds', () => {
    const project = createProject();
    const product = SCHNEIDER_PRODUCTS.find(item => item.reference === 'EZ9EUD212')!;
    const result = addProductToProject(project.data, product);
    const sheet = result.data.sheets[0];
    sheet.boardPlacements = [{ boardId: result.boardId, x: -20, y: -30 }];
    const bounds = getPlanSheetBounds(sheet, result.data.devices, project.assets, 'images', result.data.boards);
    expect(bounds.x).toBe(-108);
    expect(bounds.y).toBe(-118);
  });
});
