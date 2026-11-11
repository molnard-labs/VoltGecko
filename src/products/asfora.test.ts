import { describe, expect, it } from 'vitest';
import source from './asfora-source.json';
import { ASFORA_PRODUCTS } from './asfora';
import { createDeviceFromProduct } from './factory';

describe('Asfora manufacturer catalogue', () => {
  it('includes the documented references exactly once and preserves their source', () => {
    expect(ASFORA_PRODUCTS).toHaveLength(282);
    expect(new Set(ASFORA_PRODUCTS.map(product => product.reference)).size).toBe(282);
    expect(ASFORA_PRODUCTS.map(product => product.reference).sort()).toEqual(source.products.map(product => product.sku).sort());
    for (const product of ASFORA_PRODUCTS) {
      expect(product.range).toBe('Asfora');
      expect(product.mounting).toBe('floor');
      expect(product.sourcePage).toBeGreaterThan(0);
      expect(product.sourceUrl).toBe(source.sourceUrl);
      expect(product.image).toBeTruthy();
    }
  });

  it('preserves documented switch types, colours and frame requirements', () => {
    const find = (sku: string) => ASFORA_PRODUCTS.find(product => product.reference === sku)!;
    expect(find('EPH0400171')).toMatchObject({ kind: 'switch', variant: 'switch-two-way', category: 'floor-switch' });
    expect(find('EPH0400171').description.hu).toContain('keret külön');
    expect(find('EPH0400121').description.hu).toContain('Keretet tartalmaz');
    expect(find('EPH0500121').variant).toBe('switch-intermediate');
    expect(find('EPH0600121').variant).toBe('switch-double-two-way');
    expect(find('EPH9900121')).toMatchObject({ kind: 'outlet', variant: 'outlet-double' });
    expect(find('EPH5800171').category).toBe('floor-accessory');
    const device = createDeviceFromProduct(find('EPH0400171'), []);
    expect(device.variant).toBe('switch-two-way');
    expect(device.product?.reference).toBe('EPH0400171');
    expect(device.product?.mounting).toBe('floor');
  });
});
