import { t, getLanguage, getLocale } from '../i18n';
import { jsPDF } from 'jspdf';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SymbolGlyph } from '../components/Symbol';
import { APP } from '../config';
import { catalogEntryId, deviceLabel } from '../catalog';
import { getBoardIssues } from '../data/boardPlacement';
import type { Asset, Device, DeviceKind, DeviceVariant, PlanSheet, ProjectDocument } from '../types';
import { downloadBlob, safeFilename } from './files';
import { buildSingleLineSvg, cableLabel, circuitCableLabel } from './singleLine';
import { getBoardConnectionIssues } from '../data/boardConnections';
import { getWiringIssues, wiringEndpointLabel, getPhaseLoads } from '../data/boardWiring';
import { diagramTiles } from './diagramPages';
import { getFloorPlanDisplay, getPlanAppearance } from '../data/planAppearance';

type Audience = 'client' | 'professional';
const PAGE_W = 420, PAGE_H = 297, MARGIN = 18, WIDTH = PAGE_W - 2 * MARGIN;
const INK = '#213c49', MUTED = '#627681', TEAL = '#087e78', RULE = '#dbe5e7';
const statuses = { planned: 'Tervezett', installed: 'Szerelve', verified: 'Ellenőrizve' };
let fontPromise: Promise<string> | undefined;

function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 0x8000) result += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(result);
}

async function fontData(): Promise<string> {
  if (!fontPromise) fontPromise = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`);
    if (!response.ok) throw new Error(t('A PDF betűkészlete nem érhető el. Nyisd meg egyszer online az alkalmazást, hogy az offline állományok letöltődjenek.'));
    return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  })().catch(error => { fontPromise = undefined; throw error; });
  return fontPromise;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(t('A PDF egyik háttérképe vagy fotója nem olvasható.')));
    image.src = source;
  });
}

async function rasterAsset(asset: Asset, maxEdge = 3000, transparent = false): Promise<HTMLCanvasElement> {
  const image = await loadImage(asset.data);
  const factor = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * factor));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * factor));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('A böngészőben a PDF képfeldolgozása nem érhető el.'));
  if (!transparent) { context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

type PlanRaster = { data: string; widthRatio: number; heightRatio: number };
function rotatedSize(width: number, height: number, rotation: number) {
  const radians = rotation * Math.PI / 180;
  const cosine = Math.abs(Math.cos(radians)), sine = Math.abs(Math.sin(radians));
  return { width: width * cosine + height * sine, height: width * sine + height * cosine };
}

/** Rotate around the centre on an alpha canvas; jsPDF's image rotation uses a corner as its origin. */
function planRaster(source: HTMLCanvasElement, rotation: number, opacity = 1): PlanRaster {
  const bounds = rotatedSize(source.width, source.height, rotation);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(bounds.width - 1e-8)); canvas.height = Math.max(1, Math.ceil(bounds.height - 1e-8));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(t('A böngészőben a PDF képfeldolgozása nem érhető el.'));
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(rotation * Math.PI / 180); context.globalAlpha = opacity;
  context.drawImage(source, -source.width / 2, -source.height / 2);
  const edge = Math.max(source.width, source.height);
  const result = { data: canvas.toDataURL('image/png'), widthRatio: canvas.width / edge, heightRatio: canvas.height / edge };
  canvas.width = 0; canvas.height = 0;
  return result;
}

function shortText(pdf: jsPDF, value: string, width: number, size?: number): string {
  if (size) pdf.setFontSize(size);
  if (pdf.getTextWidth(value) <= width) return value;
  let next = value;
  while (next.length && pdf.getTextWidth(`${next}…`) > width) next = next.slice(0, -1);
  return `${next}…`;
}

/** A3 sheets are followed by searchable, paginated lists; Hungarian text uses an embedded OFL font. */
export async function buildPdf(doc: ProjectDocument, audience: Audience): Promise<Blob> {
  const locale = getLocale();
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3', compress: true });
  pdf.addFileToVFS('NotoSans-Regular.ttf', await fontData());
  pdf.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  pdf.setFont('NotoSans');
  pdf.setLanguage(getLanguage() === 'en' ? 'en-GB' : 'hu');
  pdf.setProperties({ title: doc.data.name, subject: audience === 'professional' ? t('Részletes villamos tervdokumentáció') : t('Villamos terv · ügyfélpéldány'), author: t(APP.name), creator: t(APP.name) });
  let pageStarted = false;
  let y = 0;
  const deviceMap = new Map(doc.data.devices.map(device => [device.id, device]));
  const circuitMap = new Map(doc.data.circuits.map(circuit => [circuit.id, circuit]));
  const iconCache = new Map<string, string>();
  const planRasterCache = new Map<string, Promise<PlanRaster>>();
  const floorPlanDisplay = getFloorPlanDisplay(doc.data);

  function text(value: string, x: number, atY: number, size = 9, color = INK) {
    pdf.setFont('NotoSans'); pdf.setFontSize(size); pdf.setTextColor(color); pdf.text(value, x, atY);
  }
  function page(title: string, subtitle = '') {
    if (pageStarted) pdf.addPage('a3', 'landscape');
    pageStarted = true;
    pdf.setFillColor(TEAL); pdf.rect(MARGIN, 16, 2, 13, 'F');
    text(shortText(pdf, doc.data.name, WIDTH - 10, 16), MARGIN + 7, 22, 16);
    text(audience === 'professional' ? t('RÉSZLETES TERVDOKUMENTÁCIÓ') : t('ÜGYFÉLPÉLDÁNY'), MARGIN + 7, 29, 7.5, MUTED);
    text(shortText(pdf, title, WIDTH, 12), MARGIN, 41, 12);
    const meta = [subtitle, doc.data.site, doc.data.client && t('Megrendelő: {client}', { client: doc.data.client })].filter(Boolean).join('  ·  ');
    if (meta) text(shortText(pdf, meta.replace(/\s+/g, ' '), WIDTH, 8), MARGIN, 48, 8, MUTED);
    pdf.setDrawColor(RULE); pdf.setLineWidth(0.25); pdf.line(MARGIN, 52, PAGE_W - MARGIN, 52);
    y = 61;
  }

  async function icon(kind: DeviceKind, color: string, variant?: DeviceVariant): Promise<string> {
    const key = `${kind}:${variant ?? ''}:${color}`;
    const cached = iconCache.get(key); if (cached) return cached;
    const markup = renderToStaticMarkup(createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', width: 160, height: 160, viewBox: '-19 -19 38 38' }, createElement(SymbolGlyph, { kind, variant, color })));
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);
    const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 160;
    const context = canvas.getContext('2d');
    if (!context) throw new Error(t('A PDF rajzjele nem renderelhető.'));
    context.drawImage(image, 0, 0); const data = canvas.toDataURL('image/png');
    iconCache.set(key, data); return data;
  }

  function deviceRaster(asset: Asset, rotation: number, opacity: number): Promise<PlanRaster> {
    const key = JSON.stringify([asset.id, rotation, opacity]);
    let cached = planRasterCache.get(key);
    if (!cached) {
      cached = (async () => {
        const source = await rasterAsset(asset, 1200, true);
        try { return planRaster(source, rotation, opacity); }
        finally { source.width = 0; source.height = 0; }
      })();
      planRasterCache.set(key, cached);
    }
    return cached;
  }

  const missingImage: Asset = {
    id: 'pdf:missing-plan-image', name: '', mime: 'image/svg+xml',
    data: `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="-40 -40 80 80"><rect x="-38" y="-38" width="76" height="76" rx="6" fill="#f1f5f5" stroke="#82969c" stroke-width="1.5" stroke-dasharray="4 3"/><rect x="-15" y="-12" width="30" height="24" rx="2" fill="none" stroke="#627681" stroke-width="2"/><circle cx="7" cy="-5" r="2.5" fill="#627681"/><path d="M-15 8 -5 -2 1 4 5 0 15 10" fill="none" stroke="#627681" stroke-width="2" stroke-linejoin="round"/></svg>')}`,
  };

  async function sheetPage(sheet: PlanSheet) {
    const displayName = floorPlanDisplay === 'images' ? t('Valós képek') : t('Rajzjelek');
    page(sheet.name, `${t('{devices} eszköz · {connections} kapcsolat', { devices: sheet.placements.length, connections: sheet.routes.length })} · ${displayName}`);
    const field = { x: MARGIN, y: 58, w: WIDTH, h: 190 };
    const appearances = new Map(sheet.placements.flatMap(placement => {
      const device = deviceMap.get(placement.deviceId);
      return device ? [[device.id, getPlanAppearance(device, doc.assets, floorPlanDisplay)] as const] : [];
    }));
    const rasters = new Map<string, PlanRaster>();
    let minX = 0, minY = 0, maxX = sheet.width, maxY = sheet.height;
    for (const placement of sheet.placements) {
      let appearance = appearances.get(placement.deviceId);
      if (!appearance || appearance.kind === 'symbol') continue;
      let raster: PlanRaster;
      try {
        raster = await deviceRaster(appearance.kind === 'image' ? appearance.asset : missingImage, placement.rotation, appearance.opacity);
      } catch (error) {
        if (appearance.kind !== 'image') throw error;
        // Match the editor's missing-image state if an imported photograph cannot be decoded.
        appearance = { kind: 'missing-image', size: appearance.size, opacity: 1 };
        appearances.set(placement.deviceId, appearance);
        raster = await deviceRaster(missingImage, placement.rotation, 1);
      }
      rasters.set(placement.deviceId, raster);
      const width = appearance.size * raster.widthRatio, height = appearance.size * raster.heightRatio;
      minX = Math.min(minX, placement.x - width / 2); minY = Math.min(minY, placement.y - height / 2);
      maxX = Math.max(maxX, placement.x + width / 2); maxY = Math.max(maxY, placement.y + height / 2);
    }
    const padding = 32;
    const contentWidth = maxX - minX, contentHeight = maxY - minY;
    const scale = Math.min(field.w / (contentWidth + padding * 2), field.h / (contentHeight + padding * 2));
    const x = field.x + (field.w - contentWidth * scale) / 2 - minX * scale;
    const top = field.y + (field.h - contentHeight * scale) / 2 - minY * scale;
    const px = (value: number) => x + value * scale;
    const py = (value: number) => top + value * scale;
    pdf.setFillColor('#fafcfc'); pdf.setDrawColor(RULE); pdf.rect(field.x, field.y, field.w, field.h, 'FD');
    if (sheet.backgroundAssetId && doc.assets[sheet.backgroundAssetId]) {
      const canvas = await rasterAsset(doc.assets[sheet.backgroundAssetId]);
      pdf.addImage(canvas, 'PNG', x, top, sheet.width * scale, sheet.height * scale, undefined, 'FAST');
      canvas.width = 0; canvas.height = 0;
    }
    const placements = new Map(sheet.placements.map(placement => [placement.deviceId, placement]));
    for (const route of sheet.routes) {
      const from = placements.get(route.fromDeviceId), to = placements.get(route.toDeviceId);
      if (!from || !to) continue;
      const points = [from, ...route.points, to];
      const circuit = route.circuitId ? circuitMap.get(route.circuitId) : undefined;
      pdf.setDrawColor(route.kind === 'control' ? '#9a60ba' : circuit?.color || TEAL);
      pdf.setLineWidth(route.kind === 'control' ? 0.45 : 0.65);
      pdf.setLineDashPattern(route.kind === 'control' ? [2, 1.3] : [], 0);
      for (let i = 1; i < points.length; i++) pdf.line(px(points[i - 1].x), py(points[i - 1].y), px(points[i].x), py(points[i].y));
    }
    pdf.setLineDashPattern([], 0);
    for (const annotation of sheet.annotations) {
      const lines = pdf.splitTextToSize(annotation.text, Math.max(20, Math.min(70, field.w / 4))) as string[];
      text(lines.slice(0, 4).join('\n'), Math.max(field.x + 1, Math.min(field.x + field.w - 75, px(annotation.x))), Math.max(field.y + 3, Math.min(field.y + field.h - 16, py(annotation.y))), 8.5, MUTED);
    }
    const labels: { x: number; y: number; w: number; h: number }[] = [];
    const symbolSize = Math.max(4.2, Math.min(8, 38 * scale));
    function appearanceSize(placement: typeof sheet.placements[number]) {
      const appearance = appearances.get(placement.deviceId), raster = rasters.get(placement.deviceId);
      return appearance && raster ? { width: appearance.size * raster.widthRatio * scale, height: appearance.size * raster.heightRatio * scale } : rotatedSize(symbolSize, symbolSize, placement.rotation);
    }
    const appearanceBoxes = sheet.placements.map(placement => {
      const { width, height } = appearanceSize(placement);
      return { x: px(placement.x) - width / 2, y: py(placement.y) - height / 2, w: width, h: height };
    });
    for (const placement of sheet.placements) {
      const device = deviceMap.get(placement.deviceId); if (!device) continue;
      const color = device.circuitId ? circuitMap.get(device.circuitId)?.color || TEAL : TEAL;
      const centerX = px(placement.x), centerY = py(placement.y);
      const appearance = appearances.get(device.id)!;
      const { width: drawingWidth, height: drawingHeight } = appearanceSize(placement);
      let raster = rasters.get(device.id);
      if (appearance.kind === 'symbol') {
        pdf.setFillColor('#ffffff'); pdf.circle(centerX, centerY, symbolSize * 0.52, 'F');
        raster = await deviceRaster({ id: `pdf:symbol:${device.kind}:${device.variant ?? ''}:${color}`, name: '', mime: 'image/png', data: await icon(device.kind, color, device.variant) }, placement.rotation, 1);
      }
      if (raster) pdf.addImage(raster.data, 'PNG', centerX - drawingWidth / 2, centerY - drawingHeight / 2, drawingWidth, drawingHeight, undefined, 'FAST');
      pdf.setFontSize(7);
      const label = device.code;
      const width = Math.min(65, Math.max(8, pdf.getTextWidth(label) + 2));
      const height = 4.2, offsetX = drawingWidth / 2 + 1, offsetY = drawingHeight / 2 + 1;
      const points = [
        { x: centerX + offsetX, y: centerY - 2 }, { x: centerX - width - offsetX, y: centerY - 2 },
        { x: centerX - width / 2, y: centerY + offsetY }, { x: centerX - width / 2, y: centerY - offsetY - height },
      ];
      // Crowded plans need room to move the code away from a bank of switches.
      for (let distance = 6; distance <= 36; distance += 6) for (const direction of [-1, 1]) {
        points.push({ x: centerX + offsetX, y: centerY + direction * distance - height / 2 });
        points.push({ x: centerX - width - offsetX, y: centerY + direction * distance - height / 2 });
        points.push({ x: centerX - width / 2 + direction * distance, y: centerY + offsetY });
        points.push({ x: centerX - width / 2 + direction * distance, y: centerY - offsetY - height });
      }
      const candidates = points.map(point => ({ x: Math.max(field.x + 0.5, Math.min(field.x + field.w - width - 0.5, point.x)), y: Math.max(field.y + 0.5, Math.min(field.y + field.h - height - 0.5, point.y)), w: width, h: height }));
      const overlap = (candidate: typeof labels[number], previous: typeof labels[number]) => Math.max(0, Math.min(candidate.x + candidate.w + 0.4, previous.x + previous.w) - Math.max(candidate.x - 0.4, previous.x)) * Math.max(0, Math.min(candidate.y + candidate.h + 0.4, previous.y + previous.h) - Math.max(candidate.y - 0.4, previous.y));
      const score = (candidate: typeof labels[number]) => [...labels, ...appearanceBoxes].reduce((sum, previous) => sum + overlap(candidate, previous) * 100, 0) + Math.hypot(Math.max(candidate.x, Math.min(centerX, candidate.x + width)) - centerX, Math.max(candidate.y, Math.min(centerY, candidate.y + height)) - centerY);
      const selected = candidates.sort((a, b) => score(a) - score(b))[0]; labels.push(selected);
      const leaderX = Math.max(selected.x, Math.min(centerX, selected.x + width)), leaderY = Math.max(selected.y, Math.min(centerY, selected.y + height));
      if (Math.hypot(leaderX - centerX, leaderY - centerY) > Math.max(drawingWidth, drawingHeight)) {
        const dx = leaderX - centerX, dy = leaderY - centerY;
        const edge = Math.min(Math.abs((drawingWidth / 2) / dx), Math.abs((drawingHeight / 2) / dy));
        pdf.setDrawColor('#97a8af'); pdf.setLineWidth(0.15); pdf.line(centerX + dx * edge, centerY + dy * edge, leaderX, leaderY);
      }
      pdf.setFillColor('#ffffff'); pdf.rect(selected.x, selected.y, selected.w, selected.h, 'F');
      text(shortText(pdf, label, width - 1), selected.x + 0.5, selected.y + 2.9, 7);
    }
    const legendDevices = [...new Map(sheet.placements.flatMap(placement => {
      const device = deviceMap.get(placement.deviceId);
      return device ? [[catalogEntryId(device), device] as const] : [];
    })).values()];
    const legendIcon = async (device: Device, x: number, y: number, width: number) => {
      pdf.addImage(await icon(device.kind, TEAL, device.variant), 'PNG', x, y - 3.2, 4.6, 4.6);
      text(shortText(pdf, deviceLabel(device), width - 8, 7.5), x + 6, y, 7.5);
    };
    if (floorPlanDisplay === 'images') {
      text(t('VALÓS KÉPEK'), MARGIN, 258, 7.5, MUTED);
      text(t('A képek a kiválasztott terméket szemléltetik; az azonosítók az eszközjegyzékre hivatkoznak.'), MARGIN, 265, 7.5);
      if ([...appearances.values()].some(appearance => appearance.kind === 'missing-image')) {
        const placeholder = await deviceRaster(missingImage, 0, 1);
        pdf.addImage(placeholder.data, 'PNG', MARGIN, 268, 4.6, 4.6);
        text(t('Nincs alaprajzi kép hozzárendelve'), MARGIN + 6, 271.5, 7.5, MUTED);
      }
    } else {
      text(t('JELMAGYARÁZAT'), MARGIN, 258, 7.5, MUTED);
      for (let i = 0; i < Math.min(8, legendDevices.length); i++) {
        await legendIcon(legendDevices[i], MARGIN + i % 4 * (WIDTH / 4), 265 + Math.floor(i / 4) * 7, WIDTH / 4);
      }
      if (legendDevices.length > 8) text(t('Teljes jelmagyarázat a következő oldalon.'), MARGIN, 276, 7, MUTED);
    }
    const scaleText = sheet.mmPerUnit ? t('Nyomtatási lépték: kb. 1:{scale} (A3, 100%)', { scale: Math.round(sheet.mmPerUnit / scale) }) : t('Méretarány nincs beállítva · vázlat');
    text(scaleText, MARGIN, 280, 7, MUTED);
    text(t('Folytonos: tápellátás    Szaggatott: vezérlés'), MARGIN + 145, 280, 7, MUTED);
    if (floorPlanDisplay === 'symbols' && legendDevices.length > 8) {
      page(t('JELMAGYARÁZAT'), sheet.name);
      for (let i = 0; i < legendDevices.length; i++) {
        await legendIcon(legendDevices[i], MARGIN + i % 3 * (WIDTH / 3), 70 + Math.floor(i / 3) * 16, WIDTH / 3);
      }
    }
  }

  function table(title: string, headers: string[], widths: number[], rows: string[][], subtitle = '') {
    function header() {
      pdf.setFillColor('#edf4f4'); pdf.rect(MARGIN, y - 4.6, WIDTH, 9.3, 'F');
      let x = MARGIN;
      headers.forEach((label, index) => { text(t(label), x + 2, y + 0.8, 8, TEAL); x += widths[index]; });
      y += 10;
    }
    page(title, subtitle); header();
    if (!rows.length) { text(t('Nincs rögzített adat.'), MARGIN + 2, y + 4, 9, MUTED); return; }
    rows.forEach((row, rowIndex) => {
      pdf.setFontSize(8);
      const cells = widths.map((width, index) => pdf.splitTextToSize(String(row[index] || '—'), width - 4) as string[]);
      const totalLines = Math.max(...cells.map(lines => lines.length));
      let offset = 0;
      while (offset < totalLines) {
        if (y + 9 > 278) { page(t('{title} · folytatás', { title }), subtitle); header(); }
        const count = Math.min(totalLines - offset, Math.max(1, Math.floor((278 - y - 4) / 4.2)));
        const height = Math.max(9, count * 4.2 + 3.5);
        if (rowIndex % 2 === 1) { pdf.setFillColor('#f7fafa'); pdf.rect(MARGIN, y - 3.6, WIDTH, height, 'F'); }
        let x = MARGIN;
        cells.forEach((lines, index) => { const segment = lines.slice(offset, offset + count); if (segment.length) text(segment.join('\n'), x + 2, y, 8); x += widths[index]; });
        pdf.setDrawColor(RULE); pdf.setLineWidth(0.15); pdf.line(MARGIN, y - 3.6 + height, PAGE_W - MARGIN, y - 3.6 + height);
        y += height; offset += count;
      }
    });
  }

  if (doc.data.sheets.length) for (const sheet of doc.data.sheets) await sheetPage(sheet);
  else page(t('Projektáttekintés'));

  for (const board of doc.data.boards) {
    const boardSubtitle = [t('Elosztó · modulkiosztás'), board.product?.reference].filter(Boolean).join(' · ');
    page(board.name, boardSubtitle);
    const issues = getBoardIssues(board, doc.data.devices);
    for (const row of board.rows) {
      if (y + 53 > 274) page(t('{title} · folytatás', { title: board.name }), boardSubtitle);
      const used = row.placements.reduce((sum, placement) => sum + (deviceMap.get(placement.deviceId)?.moduleWidth ?? 1), 0);
      text(t('{row} · {used} / {capacity} modul', { row: row.name, used, capacity: row.capacity }), MARGIN, y, 10);
      const atY = y + 5, height = 29, moduleW = WIDTH / row.capacity;
      pdf.setFillColor('#f3f6f6'); pdf.setDrawColor(RULE); pdf.rect(MARGIN, atY, WIDTH, height, 'FD');
      for (let n = 1; n < row.capacity; n++) { pdf.setLineWidth(0.15); pdf.line(MARGIN + n * moduleW, atY, MARGIN + n * moduleW, atY + height); }
      for (const placement of row.placements) {
        const device = deviceMap.get(placement.deviceId); if (!device) continue;
        const start = Math.max(0, placement.start), end = Math.min(row.capacity, placement.start + (device.moduleWidth ?? 1));
        if (end <= start) continue;
        const x = MARGIN + start * moduleW, w = (end - start) * moduleW;
        const invalid = issues.some(issue => issue.deviceId === device.id && issue.rowId === row.id);
        pdf.setFillColor(invalid ? '#fff0ed' : '#ffffff'); pdf.setDrawColor(invalid ? '#ca4838' : '#9dbbbd'); pdf.rect(x + 0.3, atY + 0.6, Math.max(0.2, w - 0.6), height - 1.2, 'FD');
        pdf.setFontSize(8); text(shortText(pdf, device.code, Math.max(0, w - 2)), x + 1, atY + 6, 8);
        pdf.setFillColor(invalid ? '#ca4838' : TEAL); pdf.roundedRect(x + w * 0.37, atY + 10, Math.max(0.2, w * 0.26), 6, 0.4, 0.4, 'F');
        pdf.setFontSize(6.5); text(shortText(pdf, device.rating || deviceLabel(device), Math.max(0, w - 2)), x + 1, atY + 24, 6.5, MUTED);
      }
      for (let n = 0; n < row.capacity; n += row.capacity > 36 ? 5 : 1) text(String(n + 1), MARGIN + n * moduleW + 0.8, atY + height + 4, 6.5, MUTED);
      y += 51;
    }
    const boardRows: string[][] = [];
    for (const row of board.rows) for (const placement of row.placements) {
      const device = deviceMap.get(placement.deviceId); if (!device) continue;
      const circuits = doc.data.circuits.filter(circuit => circuit.protectionDeviceId === device.id).map(circuit => circuit.code).join(', ');
      boardRows.push([row.name, String(placement.start + 1), String(device.moduleWidth ?? 1), device.code, `${device.name}\n${deviceLabel(device)}`, device.rating || '', circuits || (device.circuitId ? circuitMap.get(device.circuitId)?.code || '' : ''), device.model]);
    }
    table(t('{board} · készülékjegyzék', { board: board.name }), ['Sor', 'Kezdőhely', 'Modul', 'Azonosító', 'Készülék', 'Névleges adat', 'Áramkör', 'Típus / modell'], [35, 25, 20, 46, 96, 55, 35, 72], boardRows);
    const accessories = doc.data.devices.filter(device => device.boardId === board.id && device.product?.mounting === 'accessory');
    if (accessories.length) table(t('{board} · tartozékjegyzék', { board: board.name }), ['Azonosító', 'Cikkszám', 'Készülék', 'Mennyiség', 'Megjegyzés'], [35, 45, 104, 30, 170], accessories.map(device => [device.code, device.product!.reference, device.name, `${(device.quantity ?? 1).toLocaleString(locale)} ${t('db')}`, [device.product?.description?.[getLanguage()], device.notes].filter(Boolean).join('\n')]), board.product?.reference);
    if (issues.length) table(t('{board} · ellenőrzendő jelzések', { board: board.name }), ['Sor', 'Jelzés'], [55, WIDTH - 55], issues.map(issue => [board.rows.find(row => row.id === issue.rowId)?.name || '', issue.message]));
    if (board.connections?.length || board.wiring?.wires.length) {
      const drawing=buildSingleLineSvg(doc.data,board);
      // Keep schematic text readable on A3, tiling large diagrams instead of shrinking them.
      const mmPerUnit=.26, tileWidth=WIDTH/mmPerUnit, tileHeight=210/mmPerUnit;
      let tiles:ReturnType<typeof diagramTiles>;
      try{tiles=diagramTiles(drawing,tileWidth,tileHeight);}catch{throw new Error(t('Az egyvonalas rajz túl nagy a PDF-hez. Mentsd külön SVG-fájlként.'));}
      for(const tile of tiles){
        const {x:atX,y:atY,width:w,height:h,column,columns,row,rows}=tile;
        const xml=new DOMParser().parseFromString(drawing.svg,'image/svg+xml');
        const root=xml.documentElement;root.setAttribute('viewBox',`${atX} ${atY} ${w} ${h}`);root.setAttribute('width',String(Math.ceil(w*1.5)));root.setAttribute('height',String(Math.ceil(h*1.5)));
        const image=await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(xml))}`);
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*1.5);canvas.height=Math.ceil(h*1.5);
        const context=canvas.getContext('2d');if(!context)throw new Error(t('A böngészőben a PDF képfeldolgozása nem érhető el.'));
        context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
        page(t('{board} · egyvonalas rajz',{board:board.name}),tiles.length>1?t('Rajzrészlet: {column}/{columns}. oszlop · {row}/{rows}. sor',{column,columns,row,rows}):'');
        pdf.addImage(canvas,'PNG',MARGIN,60,w*mmPerUnit,h*mmPerUnit,undefined,'FAST');canvas.width=0;canvas.height=0;
      }
      if(board.connections?.length) table(t('{board} · elosztókapcsolatok',{board:board.name}),['Kiinduló eszköz','Cél eszköz'],[WIDTH/2,WIDTH/2],board.connections.map(connection=>[
        connection.fromDeviceId?`${deviceMap.get(connection.fromDeviceId)?.code??'?'} · ${deviceMap.get(connection.fromDeviceId)?.name??'?'}`:board.supplyLabel||t('Külső betáplálás'),
        `${deviceMap.get(connection.toDeviceId)?.code??'?'} · ${deviceMap.get(connection.toDeviceId)?.name??'?'}`,
      ]));
      const connectionIssues=getBoardConnectionIssues(board,doc.data.devices);
      if(connectionIssues.length)table(t('Kapcsolati jelzések'),['Jelzés'],[WIDTH],connectionIssues.map(issue=>[issue.message]));
    }
    if(board.wiring){
      if(board.wiring.wires.length)table(t('{board} · kapocshuzalozás',{board:board.name}),['Azonosító','Végpont A','Végpont B','Kábel / vezeték','Megjegyzés'],[35,95,95,89,70],board.wiring.wires.map(wire=>[wire.id,wiringEndpointLabel(doc.data,wire.from),wiringEndpointLabel(doc.data,wire.to),cableLabel(wire.cable),wire.label??'']));
      if(board.wiring.buses.length)table(t('{board} · sínkiosztás',{board:board.name}),['Sín','Vezető','Kapcsok','Kapocskiosztás'],[70,35,30,249],board.wiring.buses.map(bus=>[bus.name,bus.conductor,String(bus.capacity),bus.terminalLabels.map((label,index)=>label?`${index+1}: ${label}`:'').filter(Boolean).join('\n')]));
      if(board.wiring.infeeds.length)table(t('{board} · betáplálások',{board:board.name}),['Megnevezés','Pólusok','Kábel / vezeték'],[100,80,204],board.wiring.infeeds.map(infeed=>[infeed.name,infeed.poles.join(' / '),cableLabel(infeed.cable)]));
      const loads=getPhaseLoads(doc.data,board),factor=board.wiring.demandFactor??1;
      table(t('{board} · fázisterhelés',{board:board.name}),['L1 (W)','L2 (W)','L3 (W)','Nincs kiosztva (W)','Egyidejű teljesítmény (W)'],[60,60,60,90,114],[[loads.L1,loads.L2,loads.L3,loads.unassignedW,loads.totalW*factor].map(value=>value.toLocaleString(locale,{maximumFractionDigits:1}))],t('A rögzített fogyasztói adatok összege; a tényező nem módosítja az egyedi áramköröket.'));
      const wiringIssues=getWiringIssues(doc.data,board);
      if(wiringIssues.length)table(t('Huzalozási jelzések'),['Jelzés'],[WIDTH],wiringIssues.map(issue=>[issue.message]));
    }
  }

  if (audience === 'professional') {
    table(t('Eszközjegyzék'), ['Azonosító', 'Eszköz', 'Helyiség', 'Áramkör', 'Mag. mm', 'Modell', 'Állapot', 'Megjegyzés'], [43, 54, 30, 24, 20, 47, 27, 139], doc.data.devices.map(device => [device.code, `${device.name}\n${deviceLabel(device)}`, device.room, device.circuitId ? circuitMap.get(device.circuitId)?.code || '' : '', String(device.heightMm), [device.model, device.product && !device.model.includes(device.product.reference) ? device.product.reference : ''].filter(Boolean).join('\n'), t(statuses[device.status]), [device.product?.description?.[getLanguage()], device.notes].filter(Boolean).join('\n')]));
    const loadLabels={socket:'Dugalj',lamp:'Világítás',motor:'Motor',other:'Egyéb fogyasztó'};
    table(t('Áramkörjegyzék'), ['Áramkör', 'Megnevezés', 'Védelem', 'Hozzárendelt fogyasztók', 'Kábel', 'Telj. W', 'Megjegyzés'], [25, 65, 35, 74, 60, 25, 100], doc.data.circuits.map(circuit => [circuit.code, [circuit.name,circuit.loadType?t(loadLabels[circuit.loadType]):''].filter(Boolean).join('\n'), circuit.protectionDeviceId ? deviceMap.get(circuit.protectionDeviceId)?.code || '' : '', doc.data.devices.filter(device => device.circuitId === circuit.id).map(device => `${device.code} · ${device.name}`).join('\n'), circuitCableLabel(circuit),circuit.powerW===undefined?'':circuit.powerW.toLocaleString(locale),circuit.notes]));
    const routes = doc.data.sheets.flatMap(sheet => sheet.routes.map(route => [sheet.name, route.kind === 'control' ? t('Vezérlés') : t('Tápellátás'), deviceMap.get(route.fromDeviceId)?.code || '', deviceMap.get(route.toDeviceId)?.code || '', route.circuitId ? circuitMap.get(route.circuitId)?.code || '' : '']));
    table(t('Kapcsolatjegyzék'), ['Tervlap', 'Kapcsolat', 'Kiinduló eszköz', 'Cél eszköz', 'Áramkör'], [90, 55, 90, 90, 59], routes);
  } else {
    table(t('Mi hova kerül?'), ['Azonosító', 'Eszköz', 'Helyiség', 'Áramkör', 'Állapot'], [43, 128, 70, 55, 88], doc.data.devices.map(device => [device.code, `${device.name} · ${deviceLabel(device)}`, device.room, device.circuitId ? circuitMap.get(device.circuitId)?.code || '' : '', t(statuses[device.status])]));
  }
  if (doc.data.notes.trim()) table(t('Projektmegjegyzések'), ['Megjegyzés'], [WIDTH], [[doc.data.notes]]);

  if (audience === 'professional') {
    const photos = doc.data.devices.flatMap(device => device.photoIds.map(id => ({ device, asset: doc.assets[id] })).filter((entry): entry is { device: typeof device; asset: Asset } => Boolean(entry.asset)));
    for (let i = 0; i < photos.length; i += 2) {
      page(t('Helyszíni fotók'));
      for (let j = 0; j < 2 && i + j < photos.length; j++) {
        const { device, asset } = photos[i + j], columnX = MARGIN + j * (WIDTH / 2 + 3);
        text(shortText(pdf, `${device.code} · ${device.name}`, WIDTH / 2 - 6, 10), columnX, 62, 10);
        const canvas = await rasterAsset(asset, 1800);
        const scale = Math.min((WIDTH / 2 - 6) / canvas.width, 198 / canvas.height);
        pdf.addImage(canvas, 'PNG', columnX + (WIDTH / 2 - 6 - canvas.width * scale) / 2, 69, canvas.width * scale, canvas.height * scale, undefined, 'FAST');
        canvas.width = 0; canvas.height = 0;
        text(shortText(pdf, asset.name, WIDTH / 2 - 6, 7), columnX, 276, 7, MUTED);
      }
    }
  }
  const pages = pdf.getNumberOfPages();
  const timestamp = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Budapest' }).format(new Date());
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i); pdf.setDrawColor(RULE); pdf.setLineWidth(0.2); pdf.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
    text(`${t(APP.name)} · ${timestamp}`, MARGIN, PAGE_H - 7, 7, MUTED);
    pdf.setFontSize(7); pdf.setTextColor(MUTED); pdf.text(`${i} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' });
  }
  return pdf.output('blob');
}

export async function exportPdf(doc: ProjectDocument, audience: Audience): Promise<void> {
  const blob = await buildPdf(doc, audience);
  downloadBlob(blob, `${safeFilename(doc.data.name)}-${audience === 'professional' ? t('reszletes') : t('ugyfel')}.pdf`);
}
