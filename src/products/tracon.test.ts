import { describe, expect, it } from 'vitest';
import { createDeviceFromProduct } from './factory';
import { TRACON_PRODUCTS } from './tracon';

describe('Tracon main line terminals', () => {
  it('provides separate, photographed FLEAL-16/1 variants with one feed-through pole', () => {
    for (const [reference, conductor] of [['FLEAL-16/1', 'L'], ['FLEAL-16/1K', 'N'], ['FLEAL-16/1ZS', 'PE']] as const) {
      const product = TRACON_PRODUCTS.find(item => item.reference === reference)!;
      expect(product.image).toMatch(/^data:image\/webp;base64,/);
      expect(product.widthMm).toBe(13.9);
      expect(product.currentA).toBe(85);
      const device = createDeviceFromProduct(product, []);
      expect(device.moduleWidth).toBeCloseTo(13.9 / 18);
      expect(device.electrical).toEqual({ role: 'terminal', poles: [conductor] });
      expect(device.product?.reference).toBe(reference);
    }
  });
  it('includes the six manufacturer colours with their physical width, photos and common connection points', () => {
    const products = TRACON_PRODUCTS.filter(item => item.range === 'FLECU');
    expect(products.map(item => item.reference)).toEqual(['FLECU-25-16-2','FLECU-25-16-2B','FLECU-25-16-2F','FLECU-25-16-2K','FLECU-25-16-2P','FLECU-25-16-2ZS']);
    for (const product of products) {
      expect(product.image).toBeTruthy();
      expect(product.widthMm).toBe(21.3);
      const device = createDeviceFromProduct(product, []);
      expect(device.moduleWidth).toBeCloseTo(21.3 / 18);
      expect(device.electrical?.commonPoleGroups).toEqual([[0, 1]]);
      expect(device.electrical?.poles[0]).toBe(device.electrical?.poles[1]);
      expect(device.product?.reference).toBe(product.reference);
    }
  });
  it('includes the requested FLEAL at its actual width and PE designation', () => {
    const device = createDeviceFromProduct(TRACON_PRODUCTS.find(item => item.reference === 'FLEAL-150/1ZS')!, []);
    expect(device.moduleWidth).toBeCloseTo(28.9 / 18);
    expect(device.electrical).toEqual({role:'terminal', poles:['PE']});
  });
});
