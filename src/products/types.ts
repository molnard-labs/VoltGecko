import type { DeviceElectrical, DeviceKind, DeviceVariant } from '../types';

/** Manufacturer facts bundled for offline use; project devices receive a snapshot. */
export interface CatalogProduct {
  reference: string;
  manufacturer: string;
  range: string;
  category: 'mcb'|'rccb'|'rcbo'|'spd'|'switch'|'control'|'terminal'|'accessory'|'enclosure'|'floor-switch'|'floor-outlet'|'floor-data'|'floor-accessory';
  kind: DeviceKind;
  variant?: DeviceVariant;
  mounting: 'din'|'accessory'|'enclosure'|'floor';
  name: { hu:string; en:string };
  description: { hu:string; en:string };
  image?:string;
  /** A family photo rather than a verified photograph of this exact reference. */
  imageIllustrative?:boolean;
  electrical?:DeviceElectrical;
  moduleWidth?:number;
  widthMm?:number;
  poles?:string;
  currentA?:number;
  curve?:string;
  breakingCapacityKa?:number;
  residualType?:string;
  residualCurrentMa?:number;
  voltage?:string;
  boardRows?:number;
  modulesPerRow?:number;
  sourceUrl:string;
  supplementalSourceUrl?:string;
  sourcePage:number;
  sourceDocument:string;
  verifiedAt:string;
}
export interface ProductSnapshot {
  description?:{hu:string;en:string};
  reference:string; manufacturer:string; range:string; sourceUrl:string;
  supplementalSourceUrl?:string;
  sourceDocument:string; sourcePage:number; verifiedAt:string;
  mounting:CatalogProduct['mounting'];
  moduleWidth?:number; poles?:string; currentA?:number; curve?:string;
  widthMm?:number; boardRows?:number; modulesPerRow?:number;
  breakingCapacityKa?:number; residualType?:string; residualCurrentMa?:number;
  voltage?:string;
}
