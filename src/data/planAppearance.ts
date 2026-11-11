import type { Asset, Board, Device, FloorPlanDisplay, PlanSheet, ProjectData } from '../types';
import { boardImage } from '../products/boardImage';

export const DEFAULT_PLAN_IMAGE_SIZE = 80;

export type PlanAppearance =
  | { kind: 'symbol'; size: 36; opacity: 1 }
  | { kind: 'image'; asset: Asset; size: number; opacity: number }
  | { kind: 'missing-image'; size: number; opacity: 1 };

/** Keep the historical symbol view for projects created before image display. */
export function getFloorPlanDisplay(data: Pick<ProjectData, 'floorPlanDisplay'>): FloorPlanDisplay {
  return data.floorPlanDisplay === 'images' ? 'images' : 'symbols';
}

export function isPlanImageAsset(asset: Asset | undefined): asset is Asset {
  return asset !== undefined && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mime);
}

function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** One appearance contract shared by the editor and exported floor plans. */
export function getPlanAppearance(
  device: Pick<Device, 'planImage'>,
  assets: Readonly<Record<string, Asset>>,
  display: FloorPlanDisplay,
): PlanAppearance {
  if (display === 'symbols') return { kind: 'symbol', size: 36, opacity: 1 };
  const image = device.planImage;
  const size = bounded(image?.size, 24, 240, DEFAULT_PLAN_IMAGE_SIZE);
  const asset = image ? assets[image.assetId] : undefined;
  if (!isPlanImageAsset(asset)) return { kind: 'missing-image', size, opacity: 1 };
  return { kind: 'image', asset, size, opacity: bounded(image?.opacity, 0.1, 1, 1) };
}

/** Include image footprints outside the paper when fitting a complete sheet. */
export function getPlanSheetBounds(
  sheet: PlanSheet,
  devices: readonly Device[],
  assets: Readonly<Record<string, Asset>>,
  display: FloorPlanDisplay,
  boards: readonly Board[] = [],
): { x: number; y: number; width: number; height: number } {
  const padding = 48;
  if (display === 'symbols') {
    return { x: -padding, y: -padding, width: sheet.width + padding * 2, height: sheet.height + padding * 2 };
  }
  const lookup = new Map(devices.map(device => [device.id, device]));
  let minX = 0, minY = 0, maxX = sheet.width, maxY = sheet.height;
  for (const placement of sheet.placements) {
    const device = lookup.get(placement.deviceId);
    if (!device) continue;
    const appearance = getPlanAppearance(device, assets, display);
    const radians = placement.rotation * Math.PI / 180;
    const extent = appearance.size / 2 * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
    minX = Math.min(minX, placement.x - extent);
    minY = Math.min(minY, placement.y - extent);
    maxX = Math.max(maxX, placement.x + extent);
    maxY = Math.max(maxY, placement.y + extent);
  }
  for (const placement of sheet.boardPlacements ?? []) {
    const board = boards.find(item => item.id === placement.boardId);
    if (!board || !boardImage(board)) continue;
    minX = Math.min(minX, placement.x - 40); minY = Math.min(minY, placement.y - 40);
    maxX = Math.max(maxX, placement.x + 40); maxY = Math.max(maxY, placement.y + 54);
  }
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}
