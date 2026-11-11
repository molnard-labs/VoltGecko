import type { Asset, Device } from '../types';
import { ASFORA_PRODUCTS } from './asfora';

/** Resolve only trusted bundled catalogue photos. The product snapshot stays
 * small in project files, and the same image is available without a network. */
const images = new Map(ASFORA_PRODUCTS
  .filter(product => product.mounting === 'floor' && product.image)
  .map(product => [`${product.manufacturer}\0${product.reference}`, {
    asset: {
      id: `catalog:${product.manufacturer}:${product.reference}`,
      name: `${product.manufacturer} ${product.reference}`,
      mime: 'image/webp',
      data: product.image!,
    } satisfies Asset,
    illustrative: !!product.imageIllustrative,
  }]));

export function floorProductImage(device: Pick<Device, 'product'>) {
  const product = device.product;
  return product?.mounting === 'floor' ? images.get(`${product.manufacturer}\0${product.reference}`) : undefined;
}
