import source from './asfora-source.json';
import type { DeviceKind, DeviceVariant } from '../types';
import type { CatalogProduct } from './types';

interface AsforaFact {
  sku: string;
  name: string;
  color: string;
  page: number;
  category: string;
  includesFrame?: boolean;
  note?: string;
}

// Images are bundled with the catalogue so the product library also works offline.
// A substitute from the same product group is explicitly marked as illustrative.
const images = import.meta.glob<string>('./asfora-images/*.webp', {
  eager: true, query: '?inline', import: 'default',
});
const facts = source.products as AsforaFact[];
const imageFor = (sku: string) => images[`./asfora-images/${sku}.webp`];
const unaccent = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function classification(fact: AsforaFact): Pick<CatalogProduct, 'category'|'kind'|'variant'> {
  const name = unaccent(fact.name);
  const group = unaccent(fact.category);
  if (group.includes('keret') || name.includes('vakfede')) return { category: 'floor-accessory', kind: 'custom' };
  if (name.includes('fenyeroszabaly')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-dimmer' };
  if (name.includes('kettos valt')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-double-two-way' };
  if (name.includes('keresztkapcsol')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-intermediate' };
  if (name.includes('valt')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-two-way' };
  if (name.includes('csillarkapcsol')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-series' };
  if (name.includes('ketpolusu')) return { category: 'floor-switch', kind: 'switch', variant: 'switch-double-pole' };
  if (name.includes('nyomo')) return { category: 'floor-switch', kind: 'switch', variant: name.includes('jelzofennyel') ? 'switch-push-button-lit' : 'switch-push-button' };
  if (name.includes('kapcsol')) return { category: 'floor-switch', kind: 'switch' };
  if (name.includes('2x2p+f')) return { category: 'floor-outlet', kind: 'outlet', variant: 'outlet-double' };
  if (name.includes('2p+f')) return { category: 'floor-outlet', kind: 'outlet', ...(group.includes('ip44') ? { variant: 'outlet-weatherproof' as const } : {}) };
  if (name.includes('tv') || name.includes('sat')) return { category: 'floor-data', kind: 'custom', variant: 'custom-tv' };
  if (name.includes('telefon')) return { category: 'floor-data', kind: 'custom', variant: 'custom-phone' };
  if (name.includes('rj') || name.includes('hdmi') || name.includes('optikai')) return { category: 'floor-data', kind: 'custom', variant: 'custom-data' };
  return { category: 'floor-data', kind: 'custom' as DeviceKind };
}

const colorEnglish: Record<string, string> = {
  'Fehér': 'white', 'Bézs': 'beige', 'Alumínium': 'aluminium',
  'Acél': 'steel', 'Bronz': 'bronze', 'Antracit': 'anthracite',
};

function englishName(fact: AsforaFact, kind: DeviceKind, variant?: DeviceVariant): string {
  const name = unaccent(fact.name);
  if (name.includes('keret')) return 'Mounting frame';
  if (name.includes('vakfede')) return 'Blank cover';
  if (name.includes('kabelkivezet')) return 'Cable outlet';
  if (name.includes('redony')) return name.includes('nyomo') ? 'Shutter push button' : 'Shutter switch';
  if (name.includes('kartya')) return 'Card switch';
  if (name.includes('usb')) return fact.name.replace(/töltő/gi, 'charger').replace(/gyors/gi, 'fast');
  if (variant === 'switch-double-two-way') return 'Double two-way switch';
  if (variant === 'switch-intermediate') return 'Intermediate switch';
  if (variant === 'switch-two-way') return 'Two-way switch';
  if (variant === 'switch-series') return 'Two-gang switch';
  if (variant === 'switch-double-pole') return 'Double-pole switch';
  if (variant === 'switch-dimmer') return 'LED dimmer';
  if (variant === 'switch-push-button' || variant === 'switch-push-button-lit') return name.includes('kettos') ? 'Double push button' : 'Push button';
  if (kind === 'switch') return name.includes('harmas') ? 'Triple switch' : 'One-way switch';
  if (variant === 'outlet-double') return 'Double earthed socket outlet';
  if (kind === 'outlet') return 'Earthed socket outlet';
  if (name.includes('hangszoro')) return 'Double speaker connection';
  if (name.includes('optikai')) return 'Optical connection';
  if (name.includes('telefon')) return fact.name.replace(/telefon aljzat/i, 'telephone socket');
  if (name.includes('aljzat')) return fact.name.replace(/aljzat/gi, 'socket').replace(/végzáró/gi, 'terminal').replace(/átmenő/gi, 'through');
  return fact.name;
}

export const ASFORA_PRODUCTS: CatalogProduct[] = facts.map(fact => {
  const classificationResult = classification(fact);
  const exact = imageFor(fact.sku);
  const related = facts.find(other => other.sku.slice(0, -2) === fact.sku.slice(0, -2) && imageFor(other.sku))
    ?? facts.find(other => other.category === fact.category && other.color === fact.color && imageFor(other.sku))
    ?? facts.find(other => other.category === fact.category && imageFor(other.sku))
    ?? facts.find(other => classification(other).category === classificationResult.category && other.color === fact.color && imageFor(other.sku))
    ?? facts.find(other => classification(other).category === classificationResult.category && imageFor(other.sku));
  const image = exact ?? (related && imageFor(related.sku));
  const frameHu = fact.includesFrame === true ? 'Keretet tartalmaz.' : fact.includesFrame === false ? 'A keret külön szükséges.' : '';
  const frameEn = fact.includesFrame === true ? 'Frame included.' : fact.includesFrame === false ? 'Frame sold separately.' : '';
  const color = colorEnglish[fact.color] ?? fact.color;
  return {
    reference: fact.sku, manufacturer: 'Schneider Electric', range: 'Asfora', mounting: 'floor',
    ...classificationResult,
    name: { hu: `${fact.name} · ${fact.color}`, en: `${englishName(fact, classificationResult.kind, classificationResult.variant)} · ${color}` },
    description: { hu: [frameHu, fact.note].filter(Boolean).join(' '), en: [frameEn, fact.name].filter(Boolean).join(' ') },
    image, imageIllustrative: !!image && !exact,
    sourceUrl: source.sourceUrl, supplementalSourceUrl: `https://www.se.com/hu/hu/product/${fact.sku}/`,
    sourcePage: fact.page, sourceDocument: 'Schneider Electric · Asfora 2025', verifiedAt: '2026-11-11',
  };
});
