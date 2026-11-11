import type { Board } from '../types';
import { SCHNEIDER_PRODUCTS } from './schneider';

/** Resolve an enclosure's bundled photo using both manufacturer and reference.
 * Project snapshots intentionally do not embed catalogue images. */
const images = new Map(SCHNEIDER_PRODUCTS
  .filter(product => product.mounting === 'enclosure' && product.image)
  .map(product => [`${product.manufacturer}\0${product.reference}`, {
    src: product.image!, illustrative: !!product.imageIllustrative,
  }]));

export function boardImage(board: Pick<Board, 'product'>) {
  const product = board.product;
  return product ? images.get(`${product.manufacturer}\0${product.reference}`) : undefined;
}
