import { ProductLibrary } from '../components/ProductLibrary';
import { SCHNEIDER_PRODUCTS } from '../products/schneider';
import { TRACON_PRODUCTS } from '../products/tracon';
import { ASFORA_PRODUCTS } from '../products/asfora';
import type { CatalogProduct } from '../products/types';
import type { Device } from '../types';
import { canAssignFloorProduct } from '../products/factory';

export default function ManufacturerLibrary({
  onAdd,
  onClose,
  assignment,
  assignmentDevice
}: {
  onAdd: (product: CatalogProduct) => void;
  onClose: () => void;
  assignment?: boolean;
  assignmentDevice?: Device;
}) {
  const products = [...TRACON_PRODUCTS, ...SCHNEIDER_PRODUCTS, ...ASFORA_PRODUCTS];
  return <ProductLibrary products={assignment ? products.filter(product => !!assignmentDevice && canAssignFloorProduct(assignmentDevice, product)) : products} assignment={assignment} onAdd={onAdd} onClose={onClose} />;
}
