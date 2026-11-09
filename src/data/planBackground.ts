import type { Asset, PlanSheet, ProjectDocument } from '../types';

export const isEmptyPlanSheet = (sheet: PlanSheet) => !sheet.backgroundAssetId && !sheet.placements.length && !sheet.boardPlacements?.length && !sheet.routes.length && !sheet.annotations.length;

/** Fill an unused sheet once; existing drawing content always keeps its coordinates. */
export function addPlanBackgrounds(document: ProjectDocument, imported: { sheet: PlanSheet; assets: Asset[] }[], targetSheetId: string) {
  const data = structuredClone(document.data);
  const assets = { ...document.assets };
  const target = data.sheets.find(sheet => sheet.id === targetSheetId);
  let firstSheetId: string | undefined;
  imported.forEach((result, index) => {
    const sheet = structuredClone(result.sheet);
    if (index === 0 && target && isEmptyPlanSheet(target)) {
      data.sheets[data.sheets.indexOf(target)] = { ...sheet, id: target.id };
      firstSheetId = target.id;
    } else {
      data.sheets.push(sheet);
      firstSheetId ??= sheet.id;
    }
    result.assets.forEach(asset => { assets[asset.id] = asset; });
  });
  return { data, assets, firstSheetId };
}
