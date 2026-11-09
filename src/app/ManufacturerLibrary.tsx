import { ProductLibrary } from '../components/ProductLibrary';
import { SCHNEIDER_PRODUCTS } from '../products/schneider';
import { TRACON_PRODUCTS } from '../products/tracon';
import type { CatalogProduct } from '../products/types';

export default function ManufacturerLibrary({
  onAdd,
  onClose
}: {
  onAdd: (product: CatalogProduct) => void;
  onClose: () => void;
}) {
  return <ProductLibrary products={[...TRACON_PRODUCTS, ...SCHNEIDER_PRODUCTS]} onAdd={onAdd} onClose={onClose} />;
}
