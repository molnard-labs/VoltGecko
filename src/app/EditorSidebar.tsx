import { useState, type CSSProperties } from 'react';
import { BookOpen, ChevronDown, ChevronRight, CircleHelp, Search, X } from 'lucide-react';
import { APP } from '../config';
import { CATALOG, catalogEntryId, deviceLabel } from '../catalog';
import { getLocale, t } from '../i18n';
import { AppearanceControls } from '../components/AppearanceControls';
import { Brand } from '../components/Brand';
import { DeviceSymbol } from '../components/Symbol';
import { ReleaseInfo } from '../components/ReleaseInfo';
import type { FloorPlanProps } from '../components/FloorPlan';
import type { CatalogEntry, ProjectDocument } from '../types';
import { getNavigation, type View } from './navigation';

interface Props {
  document: ProjectDocument;
  view: View;
  tool: FloorPlanProps['tool'];
  selectedCatalogId?: string;
  selectedId: string | null;
  onViewChange: (view: View) => void;
  onClose: () => void;
  onProjectsOpen: () => void;
  onProductsOpen: () => void;
  onHelpOpen: () => void;
  onChooseCatalog: (entry: CatalogEntry) => void;
  onLocate: (id: string) => void;
}

export function EditorSidebar({
  document: doc,
  view,
  tool,
  selectedCatalogId,
  selectedId,
  onViewChange,
  onClose,
  onProjectsOpen,
  onProductsOpen,
  onHelpOpen,
  onChooseCatalog,
  onLocate
}: Props) {
  const [query, setQuery] = useState('');
  const [catalogQuery, setCatalogQuery] = useState('');
  const [openGroups, setOpenGroups] = useState(['switches', 'outlets', 'lights']);
  const { data } = doc;
  const nav = getNavigation();
  const catalog = CATALOG.filter((entry) => entry.category === (view === 'board' ? 'board' : 'floor'));
  const catalogSearch = catalogQuery.trim().toLocaleLowerCase(getLocale());
  const catalogGroups = [
    { id: 'switches', label: t('Kapcsolók') },
    { id: 'outlets', label: t('Dugaljak') },
    { id: 'lights', label: t('Világítás') },
    { id: 'control', label: t('Vezérlés és érzékelők') },
    { id: 'connections', label: t('Csatlakozások') }
  ];
  const visibleCatalog = catalog.filter((entry) =>
    `${entry.label} ${entry.description}`.toLocaleLowerCase(getLocale()).includes(catalogSearch)
  );
  const catalogButton = (entry: CatalogEntry) => (
    <button
      key={catalogEntryId(entry)}
      title={entry.description}
      className={tool === entry.kind && (selectedCatalogId ?? entry.kind) === catalogEntryId(entry) ? 'chosen' : ''}
      onClick={() => onChooseCatalog(entry)}
    >
      <DeviceSymbol kind={entry.kind} variant={entry.variant} size={25} />
      <span>{entry.label}</span>
      {entry.moduleWidth && <small>{entry.moduleWidth} M</small>}
    </button>
  );
  const search = query.toLocaleLowerCase(getLocale());
  const filtered = data.devices.filter((device) =>
    `${device.code} ${device.name} ${device.room}`.toLocaleLowerCase(getLocale()).includes(search)
  );
  return (
    <aside className="sidebar">
      <div className="brand brand-voltgecko">
        <Brand />
        <button className="mobile-only icon-button" aria-label={t('Eszköztár bezárása')} onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <button className="project-switch" onClick={onProjectsOpen}>
        <span className="project-avatar">{data.name.slice(0, 1).toUpperCase()}</span>
        <span>
          <strong>{data.name}</strong>
          <small>{data.site || t('Saját projekt')}</small>
        </span>
        <ChevronDown size={15} />
      </button>
      <div className="nav-label">{t('MUNKANÉZETEK')}</div>
      <nav className="main-nav">
        {nav.map((n) => (
          <button key={n.id} className={view === n.id ? 'active' : ''} onClick={() => onViewChange(n.id)}>
            <n.icon size={18} />
            {n.label}
            {n.id === 'circuits' && <span>{data.circuits.length}</span>}
            {n.id === 'history' && <span>{doc.revisions.length}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-divider" />
      <button
        className="manufacturer-library-button"
        onClick={(event) => {
          event.currentTarget.focus();
          onProductsOpen();
        }}
      >
        <BookOpen size={20} />
        <span>
          <strong>Schneider · Tracon</strong>
          <small>{t('Gyártói terméktár')}</small>
        </span>
      </button>
      {(view === 'floor' || view === 'board') && (
        <section className="sidebar-catalog" aria-labelledby="catalog-heading">
          <div className="catalog-heading">
            <h2 id="catalog-heading">{view === 'board' ? t('KÉSZÜLÉKTÁR') : t('ESZKÖZTÁR')}</h2>
            <p>{t('KATTINTS A HOZZÁADÁSHOZ')}</p>
          </div>
          {view === 'floor' ? (
            <>
              <div className="search-box catalog-search">
                <Search size={14} />
                <input
                  aria-label={t('Eszköztár keresése')}
                  placeholder={t('Eszköztípus keresése')}
                  value={catalogQuery}
                  onChange={(event) => setCatalogQuery(event.target.value)}
                />
              </div>
              <div className="catalog-groups">
                {catalogGroups.map((group) => {
                  const entries = visibleCatalog.filter((entry) => entry.group === group.id);
                  if (!entries.length) return null;
                  const open = Boolean(catalogSearch) || openGroups.includes(group.id);
                  return (
                    <div className="catalog-group" key={group.id}>
                      <button
                        className="catalog-group-toggle"
                        aria-expanded={open}
                        aria-controls={`catalog-group-${group.id}`}
                        onClick={() => setOpenGroups((current) => current.includes(group.id)
                          ? current.filter((id) => id !== group.id)
                          : [...current, group.id])}
                      >
                        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        <span>{group.label}</span>
                        <small>{entries.length}</small>
                      </button>
                      <div id={`catalog-group-${group.id}`} className="catalog-grid" hidden={!open}>
                        {entries.map(catalogButton)}
                      </div>
                    </div>
                  );
                })}
                {!visibleCatalog.length && <p className="catalog-no-results">{t('Nincs találat az eszköztárban.')}</p>}
              </div>
            </>
          ) : <div className="catalog-grid board-catalog">{catalog.map(catalogButton)}</div>}
        </section>
      )}
      <div className="device-library">
        <div className="nav-label">
          {t('A TERV ESZKÖZEI')}
          <span>{data.devices.length}</span>
        </div>
        <div className="search-box">
          <Search size={14} />
          <input
            aria-label={t('Eszköz keresése')}
            placeholder={t('Keresés az eszközök között')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="device-list">
          {filtered.map((d) => (
            <button key={d.id} className={selectedId === d.id ? 'active' : ''} onClick={() => onLocate(d.id)}>
              <span
                className="device-list-code"
                style={{ '--circuit-color': data.circuits.find((c) => c.id === d.circuitId)?.color } as CSSProperties}
              >
                {d.code}
              </span>
              <span>
                {d.name}
                <small>{d.room || deviceLabel(d)}</small>
              </span>
              <ChevronRight size={13} />
            </button>
          ))}
          {!filtered.length && <p className="subtle">{t('Nincs ilyen eszköz.')}</p>}
        </div>
      </div>
      <div className="sidebar-bottom">
        <AppearanceControls />
        <button onClick={onHelpOpen}>
          <CircleHelp size={17} />
          {t('Útmutató és adatkezelés')}
        </button>
        <div className="sidebar-release">
          <span>v{APP.version}</span>
          <ReleaseInfo compact />
        </div>
      </div>
    </aside>
  );
}
