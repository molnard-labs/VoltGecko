import type { Asset } from '../types';

/** Validate project-owned floor-plan image assets without loading the catalogue. */
export function isPlanImageAsset(asset: Asset | undefined): asset is Asset {
  return asset !== undefined && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime);
}
