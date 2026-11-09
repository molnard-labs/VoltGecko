import { afterEach, describe, expect, it } from 'vitest';
import { decodeProject, encodeProject } from '../data/archive';
import { checkpoint, createProject } from '../data/project';
import { getBoardIssues } from '../data/boardPlacement';
import { setLanguage } from '../i18n';
import { addProductToProject } from './factory';
import { SCHNEIDER_PRODUCTS, SCHNEIDER_SOURCE } from './schneider';
import source from './schneider-source.json';

const find = (reference: string) => {
  const product = SCHNEIDER_PRODUCTS.find(item => item.reference === reference);
  if (!product) throw new Error(`Missing verified catalog reference: ${reference}`);
  return product;
};
afterEach(() => setLanguage('hu'));

describe('Schneider official offer normalization', () => {
  it('uses exact reference photographs when available and identifies catalog illustrations', () => {
    for (const product of SCHNEIDER_PRODUCTS) {
      expect(product.image, product.reference).toMatch(/^data:image\/webp;base64,/);
    }
    expect(find('EZ9F57102').image).toMatch(/^data:image\/webp;base64,/);
    expect(find('EZ9F57102').imageIllustrative).toBe(false);
    const breaker = find('EZ9F57104');
    expect(breaker.image).toMatch(/^data:image\/webp;base64,/);
    expect(breaker.imageIllustrative).toBe(true);
    expect(find('EZ9F57204').image).not.toBe(breaker.image);
    expect(find('LVSXDP113').image).toMatch(/^data:image\/webp;base64,/);
    expect(find('LVSXDP113').imageIllustrative).toBe(true);
    expect(find('A9A27062').image).toMatch(/^data:image\/webp;base64,/);
  });
  it('contains exactly the explicit manufacturer references, with no invented variants or duplicates', () => {
    const references = SCHNEIDER_PRODUCTS.map(product => product.reference);
    expect(references).toHaveLength(260);
    expect(new Set(references).size).toBe(references.length);
    expect(references).toEqual(source.products.map(product => product.sku));
    expect(SCHNEIDER_PRODUCTS.filter(product => product.category === 'mcb')).toHaveLength(75);
    expect(SCHNEIDER_PRODUCTS.filter(product => product.mounting === 'accessory')).toHaveLength(75);
    expect(SCHNEIDER_PRODUCTS.filter(product => product.mounting === 'enclosure')).toHaveLength(72);
    expect(SCHNEIDER_PRODUCTS.filter(product => product.mounting === 'din')).toHaveLength(113);
    expect(SCHNEIDER_PRODUCTS.filter(product => product.mounting === 'din' && product.range === 'Easy9 Pro')).toHaveLength(112);
    expect(references).not.toContain('EZ9F57402');
    expect(references).not.toContain('EZ9D55706');
  });

  it('preserves source pages, dates and all normalized electrical ratings from the extracted offer rows', () => {
    for (const fact of source.products) {
      const product = find(fact.sku);
      expect(product.manufacturer).toBe('Schneider Electric');
      expect(product.sourcePage).toBe(fact.sourcePages[0]);
      expect(product.sourceUrl).toMatch(/^https:\/\//);
      expect(product.sourceDocument).toContain(SCHNEIDER_SOURCE.documentReference);
      expect(product.verifiedAt).toBe(SCHNEIDER_SOURCE.retrievedDate);
      expect(product.mounting).toBe(fact.mountingType);
      expect(product.poles).toBe(fact.poles);
      expect(product.currentA).toBe(fact.ratedCurrentA);
      expect(product.curve).toBe(fact.curve);
      expect(product.breakingCapacityKa).toBe(fact.breakingCapacityA === undefined ? undefined : fact.breakingCapacityA / 1000);
      expect(product.residualType).toBe(fact.residualType);
      expect(product.residualCurrentMa).toBe(fact.residualCurrentMa);
      expect(product.boardRows).toBe(fact.rows);
      expect(product.modulesPerRow).toBe(fact.modulesPerRow);
      for (const language of ['hu', 'en'] as const) {
        expect(product.name[language].trim().length).toBeGreaterThan(0);
        expect(`${product.name[language]} ${product.description[language]}`).not.toMatch(/undefined|NaN/);
      }
    }
  });

  it('converts catalog 9-mm units to 18-mm DIN modules without confusing physical millimetres', () => {
    for (const fact of source.products.filter(product => product.mountingType === 'din')) {
      const product = find(fact.sku);
      expect(product.moduleWidth).toBe(fact.widthModules18);
      expect(product.widthMm).toBe(fact.widthMm);
      expect(product.moduleWidth! * 18).toBe(product.widthMm);
    }
    expect(find('EZ9A29924').moduleWidth).toBe(0.5);
    expect(find('EZ9A29927').moduleWidth).toBe(0.5);
    expect(find('EZ9A29476').moduleWidth).toBe(1);
    expect(find('EZ9D55616').moduleWidth).toBe(2);
    expect(find('EZ9D55716').moduleWidth).toBe(5);
    expect(find('EZ9D55716').widthMm).toBe(90);
    expect(find('A9A27062').moduleWidth).toBe(0.5);
    expect(find('A9A27062').supplementalSourceUrl).toContain('/A9A27062/');
    expect(find('A9A27062').description.en).toContain('set of 5');
    for (const product of SCHNEIDER_PRODUCTS.filter(item => item.mounting !== 'din')) expect(product.moduleWidth).toBeUndefined();
  });

  it('retains detailed SPD, contactor and accessory facts in both languages', () => {
    for (const language of ['hu', 'en'] as const) {
      expect(find('EZ9L33745').description[language]).toContain('Imax 45 kA');
      expect(find('EZ9L33745').description[language]).toContain('In 20 kA');
      expect(find('EZ9L33745').description[language]).toContain('Up 1.5 kV');
      expect(find('EZ9C32240').description[language]).toContain('AC-7a: 40 A; AC-7b: 15 A');
      expect(find('EZ9C32240').description[language]).toContain('230 V AC, 50 Hz');
      expect(find('R9XFH157').description[language]).toContain('57 × 18 mm');
      expect(find('R9XFH157').description[language]).toContain('18 mm');
      expect(find('R9XE110').description[language]).toContain('10');
      expect(find('R9XT20').description[language]).toContain('20');
      expect(find('26970').description[language]).toContain('2');
      expect(find('LGYT1E24').description[language]).toContain('3 × 6/25 + 21 × 1.5/4');
      expect(find('R9H13411').description[language]).toContain('1 × 35 + 6 × 16 mm², 125 A');
      expect(find('LVSXY624').description[language]).toContain('3');
    }
    expect(find('R9H13420').name.hu).toBe('Tervtartó');
    expect(find('R9H13420').name.en).toBe('Document holder');
    expect(find('EZ9R89463').residualCurrentMa).toBe(300);
    expect(find('EZ9R49463').residualCurrentMa).toBe(30);
    expect(find('EZ9F27116').curve).toBe('B'); expect(find('EZ9F57116').curve).toBe('C');
  });

  it('keeps enclosure rows, 18-mm capacity and door variants distinct from DIN devices', () => {
    for (const fact of source.products.filter(product => product.mountingType === 'enclosure')) {
      const product = find(fact.sku);
      expect(product.boardRows! * product.modulesPerRow!).toBe(fact.totalModules18);
      const added = addProductToProject(createProject().data, product);
      const board = added.data.boards.find(item => item.id === added.boardId)!;
      expect(board.rows).toHaveLength(fact.rows!);
      expect(board.rows.every(row => row.capacity === fact.modulesPerRow)).toBe(true);
      expect(board.product?.reference).toBe(fact.sku);
      expect(added.data.devices).toEqual([]);
    }
    expect(find('EZ9EUD312').boardRows).toBe(3); expect(find('EZ9EUD312').modulesPerRow).toBe(12);
    expect(find('LVSXQ624').boardRows).toBe(6); expect(find('LVSXQ624').modulesPerRow).toBe(24);
    expect(find('LVSXQ113').description.en).toContain('Opaque door');
    expect(find('LVSXR113').description.en).toContain('Smoked door');
    expect(find('LVSXR224').description.en).toContain('Transparent door');
    expect(find('LVSXN113').description.en).toContain('Flush-mounted');
  });

  it('round-trips every actual catalog product and its manufacturer facts through factory, history and project archive', async () => {
    for (const product of SCHNEIDER_PRODUCTS) {
      let document = createProject();
      const result = addProductToProject(document.data, product);
      document.data = result.data;
      expect(result.placed).toBe(true);
      const board = document.data.boards.find(item => item.id === result.boardId)!;
      const entity = product.mounting === 'enclosure' ? board : document.data.devices.find(item => item.id === result.selectedId)!;
      expect(entity.product?.reference).toBe(product.reference);
      expect(entity.product?.description).toEqual(product.description);
      expect(entity.product?.supplementalSourceUrl).toBe(product.supplementalSourceUrl);
      if (product.mounting === 'din') expect(getBoardIssues(board, document.data.devices)).toEqual([]);
      if (product.mounting === 'accessory') {
        expect(board.rows.flatMap(row => row.placements)).toEqual([]);
        expect(document.data.devices[0].quantity).toBe(1);
      }
      document = checkpoint(document, product.reference);
      const decoded = await decodeProject(await encodeProject(document));
      expect(decoded).toEqual(document);
    }
  });
});
