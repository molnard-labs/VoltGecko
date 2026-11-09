import { describe, expect, it } from 'vitest';
import { makeDevice } from '../catalog';
import type { Asset, Device } from '../types';
import { decodeProject, encodeProject, validateProject } from './archive';
import { DEFAULT_PLAN_IMAGE_SIZE, getFloorPlanDisplay, getPlanAppearance, getPlanSheetBounds } from './planAppearance';
import { checkpoint, createProject, restoreRevision } from './project';

const image: Asset = {
  id: 'chandelier', name: 'chandelier.png', mime: 'image/png',
  data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
};

function imageProject() {
  const document = createProject();
  const device = makeDevice('light', []);
  device.planImage = { assetId: image.id, size: 96, opacity: 0.75 };
  document.data.devices = [device];
  document.data.floorPlanDisplay = 'images';
  document.assets[image.id] = image;
  return document;
}

describe('floor-plan appearance', () => {
  it('preserves the background opacity and styled text through archive export and import', async () => {
    const document = createProject();
    const sheet = document.data.sheets[0];
    sheet.backgroundOpacity = 0.35;
    sheet.annotations.push({ id: 'label', x: 45, y: 80, text: 'Felirat\nMásodik sor', kind: 'text', fontSize: 24, color: '#123456' });
    const reopened = await decodeProject(await encodeProject(document));
    expect(reopened.data.sheets[0].backgroundOpacity).toBe(0.35);
    expect(reopened.data.sheets[0].annotations).toEqual(sheet.annotations);
    sheet.backgroundOpacity = -0.1;
    expect(() => validateProject(document)).toThrow();
  });
  it('keeps existing projects in symbol mode without adding or changing their data', async () => {
    const original = createProject();
    original.data.devices = [makeDevice('light', [])];
    const before = structuredClone(original);

    const reopened = await decodeProject(await encodeProject(original));

    expect(getFloorPlanDisplay(reopened.data)).toBe('symbols');
    expect(getPlanAppearance(reopened.data.devices[0], reopened.assets, getFloorPlanDisplay(reopened.data)))
      .toEqual({ kind: 'symbol', size: 36, opacity: 1 });
    expect(reopened).toEqual(before);
    expect(original).toEqual(before);
  });

  it('uses the explicitly configured image independently of installation photos', () => {
    const document = imageProject();
    const device = document.data.devices[0];
    expect(device.photoIds).toEqual([]);
    expect(getPlanAppearance(device, document.assets, 'images'))
      .toEqual({ kind: 'image', asset: image, size: 96, opacity: 0.75 });
    expect(getPlanAppearance(device, document.assets, 'symbols')).toEqual({ kind: 'symbol', size: 36, opacity: 1 });
  });

  it('shows a neutral missing-image appearance when only installation photos exist', () => {
    const device = makeDevice('light', []);
    device.photoIds = [image.id];
    expect(getPlanAppearance(device, { [image.id]: image }, 'images'))
      .toEqual({ kind: 'missing-image', size: DEFAULT_PLAN_IMAGE_SIZE, opacity: 1 });
  });

  it.each(['image/jpeg', 'image/webp'])('supports an existing %s attachment as the plan image', mime => {
    const document = imageProject();
    const asset = { ...image, mime };
    expect(getPlanAppearance(document.data.devices[0], { [image.id]: asset }, 'images'))
      .toEqual({ kind: 'image', asset, size: 96, opacity: 0.75 });
  });

  it('keeps a configured footprint visible when its asset is missing or unsupported', () => {
    const device = imageProject().data.devices[0];
    expect(getPlanAppearance(device, {}, 'images')).toEqual({ kind: 'missing-image', size: 96, opacity: 1 });
    expect(getPlanAppearance(device, { [image.id]: { ...image, mime: 'application/pdf' } }, 'images'))
      .toEqual({ kind: 'missing-image', size: 96, opacity: 1 });
  });

  it('roundtrips both working and historical settings and restores the saved display mode', async () => {
    const document = checkpoint(imageProject(), 'Képes terv');
    document.data.floorPlanDisplay = 'symbols';
    document.data.devices[0].planImage = { assetId: image.id, size: 120, opacity: 0.5 };
    const before = structuredClone(document);

    const reopened = await decodeProject(await encodeProject(document));
    expect(reopened).toEqual(before);
    expect(getFloorPlanDisplay(reopened.data)).toBe('symbols');
    const restored = restoreRevision(reopened, reopened.revisions[0].id);
    expect(getFloorPlanDisplay(restored.data)).toBe('images');
    expect(getPlanAppearance(restored.data.devices[0], restored.assets, 'images'))
      .toEqual({ kind: 'image', asset: image, size: 96, opacity: 0.75 });
    expect(document).toEqual(before);
  });

  it.each([
    { assetId: image.id, size: 24, opacity: 0.1 },
    { assetId: image.id, size: 240, opacity: 1 },
  ])('accepts the image-setting boundaries: %j', settings => {
    const document = imageProject();
    document.data.devices[0].planImage = settings;
    expect(() => validateProject(document)).not.toThrow();
  });

  it.each([
    { assetId: 'missing', size: 80, opacity: 1 },
    { assetId: image.id, size: 23.99, opacity: 1 },
    { assetId: image.id, size: 240.01, opacity: 1 },
    { assetId: image.id, size: Number.NaN, opacity: 1 },
    { assetId: image.id, size: Number.POSITIVE_INFINITY, opacity: 1 },
    { assetId: image.id, size: '80', opacity: 1 },
    { assetId: image.id, size: 80, opacity: 0.099 },
    { assetId: image.id, size: 80, opacity: 1.001 },
    { assetId: image.id, size: 80, opacity: Number.NaN },
    { assetId: image.id, size: 80 },
    null,
  ])('rejects invalid image references or settings: %j', settings => {
    const document = imageProject();
    document.data.devices[0].planImage = settings as Device['planImage'];
    expect(() => validateProject(document)).toThrow();
  });

  it.each(['application/pdf', 'image/gif', 'image/svg+xml'])('rejects %s as the plan image', mime => {
    const document = imageProject();
    document.assets[image.id] = {
      ...image, mime,
      data: `data:${mime};base64,${btoa(mime === 'image/svg+xml' ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'attachment')}`,
    };
    expect(() => validateProject(document)).toThrow('az alaprajzi kép PNG, JPG vagy WebP');
  });

  it('validates the display mode in working data and history', () => {
    const document = checkpoint(imageProject());
    const data = document.data as unknown as Record<string, unknown>;
    data.floorPlanDisplay = 'mixed';
    expect(() => validateProject(document)).toThrow('ismeretlen alaprajzi megjelenítés');
    document.data.floorPlanDisplay = 'images';
    (document.revisions[0].data as unknown as Record<string, unknown>).floorPlanDisplay = 'mixed';
    expect(() => validateProject(document)).toThrow('ismeretlen alaprajzi megjelenítés');
  });

  it('validates image references and settings in historical revisions', () => {
    const document = checkpoint(imageProject());
    document.revisions[0].data.devices[0].planImage!.assetId = 'missing-historical-image';
    expect(() => validateProject(document)).toThrow('Alaprajzi kép: hiányzó hivatkozás');
    document.revisions[0].data.devices[0].planImage!.assetId = image.id;
    document.revisions[0].data.devices[0].planImage!.opacity = 0;
    expect(() => validateProject(document)).toThrow('az alaprajzi kép átlátszatlansága');
  });
});

describe('fitting floor-plan image footprints', () => {
  it('retains the exact historical symbol bounds regardless of configured images and placements', () => {
    const document = imageProject();
    const sheet = document.data.sheets[0];
    sheet.placements = [{ deviceId: document.data.devices[0].id, x: -100, y: 2000, rotation: 45 }];
    const before = structuredClone(document);
    expect(getPlanSheetBounds(sheet, document.data.devices, document.assets, 'symbols'))
      .toEqual({ x: -48, y: -48, width: sheet.width + 96, height: sheet.height + 96 });
    expect(document).toEqual(before);
  });

  it('includes a large image at the paper corner with 48 units of outer padding', () => {
    const document = imageProject();
    const device = document.data.devices[0];
    device.planImage!.size = 240;
    const sheet = document.data.sheets[0];
    sheet.width = 500;
    sheet.height = 300;
    sheet.placements = [{ deviceId: device.id, x: 0, y: 0, rotation: 90 }];
    const before = structuredClone(document);

    expect(getPlanSheetBounds(sheet, document.data.devices, document.assets, 'images'))
      .toEqual({ x: -168, y: -168, width: 716, height: 516 });
    expect(document).toEqual(before);
  });

  it('includes rotated image and missing-image footprints on all paper edges', () => {
    const document = imageProject();
    const imageDevice = document.data.devices[0];
    imageDevice.planImage!.size = 240;
    const missingDevice = makeDevice('outlet', document.data.devices);
    document.data.devices.push(missingDevice);
    const sheet = document.data.sheets[0];
    sheet.width = 500;
    sheet.height = 300;
    sheet.placements = [
      { deviceId: imageDevice.id, x: 0, y: 0, rotation: 0 },
      { deviceId: missingDevice.id, x: 500, y: 300, rotation: 45 },
      { deviceId: 'non-rendered-device', x: 10_000, y: 10_000, rotation: 0 },
    ];
    const before = structuredClone(document);
    const bounds = getPlanSheetBounds(sheet, document.data.devices, document.assets, 'images');
    const rotatedHalf = DEFAULT_PLAN_IMAGE_SIZE / 2 * Math.SQRT2;

    expect(bounds.x).toBe(-168);
    expect(bounds.y).toBe(-168);
    expect(bounds.width).toBeCloseTo(500 + rotatedHalf + 120 + 96);
    expect(bounds.height).toBeCloseTo(300 + rotatedHalf + 120 + 96);
    expect(document).toEqual(before);
  });
});
