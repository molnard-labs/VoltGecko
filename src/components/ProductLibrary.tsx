import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Package, Plus, Search, X } from 'lucide-react';
import { getLocale, t, useLanguage } from '../i18n';
import type { CatalogProduct } from '../products/types';

interface Props {
  products: CatalogProduct[];
  onAdd: (product: CatalogProduct) => void;
  onClose: () => void;
}

const PAGE_SIZE = 40;
const categoryLabels: Record<CatalogProduct['category'], string> = {
  mcb: 'Kismegszakító', rccb: 'FI-relé', rcbo: 'Kombinált védelem',
  spd: 'Túlfeszültség-védelem', switch: 'Főkapcsoló', control: 'Vezérlés',
  terminal: 'Főáramköri leágazó', accessory: 'Tartozék', enclosure: 'Elosztószekrény',
  'floor-switch': 'Kapcsoló', 'floor-outlet': 'Dugalj', 'floor-data': 'Adat- és multimédiás csatlakozó', 'floor-accessory': 'Szerelvény tartozék',
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
const number = (value: number) => value.toLocaleString(getLocale());
const actionLabel = (product: CatalogProduct) => product.mounting === 'floor' ? 'Elhelyezés az alaprajzon' : product.mounting === 'enclosure' ? 'Elosztó létrehozása' : product.mounting === 'accessory' ? 'Tartozék hozzáadása' : 'Hozzáadás az elosztóhoz';

function officialSource(source: string): string | undefined {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' && ['se.com', 'schneider-electric.com', 'traconelectric.com'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) ? url.href : undefined;
  } catch { return undefined; }
}

function verifiedDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function ProductCard({ product, onAdd, language }: { product: CatalogProduct; onAdd: Props['onAdd']; language: 'hu' | 'en' }) {
  const source = officialSource(product.sourceUrl);
  const supplementarySource = product.supplementalSourceUrl ? officialSource(product.supplementalSourceUrl) : undefined;
  const specs: Array<[string, string]> = [];
  if (product.moduleWidth !== undefined) specs.push(['Modulszélesség', `${number(product.moduleWidth)} M`]);
  if (product.widthMm !== undefined) specs.push(['Szélesség', `${number(product.widthMm)} mm`]);
  if (product.poles) specs.push(['Pólusszám', product.poles]);
  if (product.currentA !== undefined) specs.push(['Névleges áram', `${number(product.currentA)} A`]);
  if (product.curve) specs.push(['Karakterisztika', product.curve]);
  if (product.breakingCapacityKa !== undefined) specs.push(['Megszakítóképesség', `${number(product.breakingCapacityKa)} kA`]);
  if (product.residualType) specs.push(['Hibaáram típusa', product.residualType]);
  if (product.residualCurrentMa !== undefined) specs.push(['Hibaáram-érzékenység', `${number(product.residualCurrentMa)} mA`]);
  if (product.voltage) specs.push(['Névleges feszültség', product.voltage]);
  if (product.boardRows !== undefined && product.modulesPerRow !== undefined) specs.push(['Elosztókapacitás', t('{rows} sor × {modules} modul', { rows: product.boardRows, modules: product.modulesPerRow })]);
  return <article className="product-card">
    <div className="product-card-top"><span className="product-range">{product.range}</span><span className="product-category">{t(categoryLabels[product.category])}</span></div>
    <strong className="product-reference">{product.reference}</strong>
    <h3>{product.name[language]}</h3>
    {product.image && <img className="product-image" src={product.image} alt={`${product.manufacturer} ${product.reference}`} loading="lazy" />}
    {product.image && product.imageIllustrative && <small className="product-image-note">{t('Termékcsalád illusztrációja')}</small>}
    {product.description[language] && <p className="product-description">{product.description[language]}</p>}
    {specs.length > 0 && <dl className="product-specs">{specs.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}</dl>}
    <div className="product-source">
      <span><BookOpen size={13} aria-hidden="true"/>{product.sourceDocument} · {t('{page}. oldal', { page: product.sourcePage })}</span>
      <span>{t('Ellenőrizve: {date}', { date: verifiedDate(product.verifiedAt) })}</span>
      {source && <a href={source} target="_blank" rel="noopener noreferrer">{t('Hivatalos gyártói forrás')}<ArrowUpRight size={13} aria-hidden="true"/></a>}
      {supplementarySource && <a href={supplementarySource} target="_blank" rel="noopener noreferrer">{t('Kiegészítő gyártói adatlap')}<ArrowUpRight size={13} aria-hidden="true"/></a>}
    </div>
    {product.category === 'floor-accessory'
      ? <small>{t('Önállóan nem helyezhető el az alaprajzon.')}</small>
      : <button type="button" className="primary product-add" onClick={() => onAdd(product)} aria-label={`${t(actionLabel(product))}: ${product.reference}`}><Plus size={15} aria-hidden="true"/>{t(actionLabel(product))}</button>}
  </article>;
}

export function ProductLibrary({ products, onAdd, onClose }: Props) {
  const { language } = useLanguage();
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null), searchRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [current, setCurrent] = useState('');
  const [poles, setPoles] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const manufacturers = [...new Set(products.map(product => product.manufacturer))].join(' · ');
  const ranges = [...new Set(products.map(product => product.range))].join(' · ');
  const categories = [...new Set(products.map(product => product.category))];
  const currents = [...new Set(products.flatMap(product => product.currentA === undefined ? [] : [product.currentA]))].sort((a, b) => a - b);
  const poleValues = [...new Set(products.flatMap(product => product.poles ? [product.poles] : []))].sort();
  const indexedProducts = useMemo(() => products.map(product => ({ product, text: normalize([
    product.reference, product.manufacturer, product.range, product.name.hu, product.name.en, product.description.hu, product.description.en,
    product.poles, product.curve, product.residualType, product.voltage,
    product.currentA === undefined ? '' : `${product.currentA}A ${product.currentA} A`,
    product.breakingCapacityKa === undefined ? '' : `${product.breakingCapacityKa}kA ${product.breakingCapacityKa} kA`,
    product.residualCurrentMa === undefined ? '' : `${product.residualCurrentMa}mA ${product.residualCurrentMa} mA`,
    product.moduleWidth === undefined ? '' : `${product.moduleWidth}M ${product.moduleWidth} M`,
  ].filter(Boolean).join(' ')) })), [products]);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const matching = indexedProducts.filter(({ product, text }) =>
    (!category || product.category === category) && (!current || String(product.currentA) === current) && (!poles || product.poles === poles) && terms.every(term => text.includes(term))
  ).map(({ product }) => product);
  const reset = () => { setQuery(''); setCategory(''); setCurrent(''); setPoles(''); setVisibleCount(PAGE_SIZE); searchRef.current?.focus(); };
  const hasFilters = Boolean(query || category || current || poles);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [query, category, current, poles]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    searchRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]') ?? []);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', handleKey, true); previousFocus?.focus(); };
  }, []);

  return <div className="product-library-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="product-library" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <header className="product-library-heading"><div><span className="eyebrow">{manufacturers || t('GYÁRTÓI KATALÓGUS')}</span><h2 id={titleId}>{t('Gyártói termékkönyvtár')}</h2><p id={descriptionId}>{ranges || t('Offline elérhető, gyártói adatokkal.')}</p></div><button type="button" className="icon-button" aria-label={t('Termékkönyvtár bezárása')} onClick={onClose}><X size={21}/></button></header>
      <div className="product-library-controls">
        <label className="product-search"><span>{t('Termék keresése')}</span><div><Search size={17} aria-hidden="true"/><input ref={searchRef} value={query} type="search" onChange={event => setQuery(event.target.value)} placeholder={t('Cikkszám, név vagy műszaki adat…')}/></div></label>
        <div className="product-filters">
          <label><span>{t('Kategória')}</span><select aria-label={t('Kategória')} value={category} onChange={event => setCategory(event.target.value)}><option value="">{t('Minden kategória')}</option>{categories.map(value => <option value={value} key={value}>{t(categoryLabels[value])}</option>)}</select></label>
          {currents.length > 1 && <label><span>{t('Névleges áram')}</span><select aria-label={t('Névleges áram')} value={current} onChange={event => setCurrent(event.target.value)}><option value="">{t('Minden áramerősség')}</option>{currents.map(value => <option key={value} value={value}>{number(value)} A</option>)}</select></label>}
          {poleValues.length > 1 && <label><span>{t('Pólusszám')}</span><select aria-label={t('Pólusszám')} value={poles} onChange={event => setPoles(event.target.value)}><option value="">{t('Minden pólusszám')}</option>{poleValues.map(value => <option value={value} key={value}>{value}</option>)}</select></label>}
        </div>
        <div className="product-results-heading"><p aria-live="polite" role="status">{t('{count} termék', { count: number(matching.length) })}{hasFilters && <span> / {number(products.length)}</span>}</p>{hasFilters && <button type="button" className="product-clear" onClick={reset}>{t('Szűrők törlése')}</button>}</div>
      </div>
      <div className="product-library-results">
        {matching.length > 0 ? <><div className="product-grid">{matching.slice(0, visibleCount).map(product => <ProductCard key={`${product.manufacturer}-${product.reference}`} product={product} onAdd={onAdd} language={language}/>)}</div>{matching.length > visibleCount && <div className="product-more"><p>{t('{shown} / {total} termék megjelenítve', { shown: number(Math.min(visibleCount, matching.length)), total: number(matching.length) })}</p><button type="button" className="quiet" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>{t('További {count} termék', { count: Math.min(PAGE_SIZE, matching.length - visibleCount) })}</button></div>}</> : <div className="product-empty"><Package size={34} aria-hidden="true"/><h3>{t('Nincs találat')}</h3><p>{t('Próbálj másik cikkszámot vagy módosítsd a szűrőket.')}</p>{hasFilters && <button type="button" className="quiet" onClick={reset}>{t('Szűrők törlése')}</button>}</div>}
      </div>
      <footer className="product-library-footer"><Package size={14} aria-hidden="true"/><span>{t('A termékadatok offline is elérhetők. A forráslinkekhez internetkapcsolat szükséges.')}</span></footer>
    </section>
  </div>;
}
