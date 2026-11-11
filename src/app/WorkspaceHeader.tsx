import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  ChevronDown,
  Cloud,
  FileText,
  FolderOpen,
  Menu,
  Redo2,
  Save,
  Undo2
} from 'lucide-react';
import { t } from '../i18n';

interface Props {
  navigation: ReactNode;
  activeView: string;
  contextActions: ReactNode;
  canUndo: boolean;
  canRedo: boolean;
  onOpenSidebar: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSaveVersion: () => void;
  onConnectFile?: () => void;
  onExportProject: () => void;
  onExportClientPdf: () => void;
  onExportProfessionalPdf: () => void;
  onOpenDrive: () => void;
  onOpenFiles: () => void;
}

export function WorkspaceHeader({
  navigation,
  activeView,
  contextActions,
  canUndo,
  canRedo,
  onOpenSidebar,
  onUndo,
  onRedo,
  onSaveVersion,
  onConnectFile,
  onExportProject,
  onExportClientPdf,
  onExportProfessionalPdf,
  onOpenDrive,
  onOpenFiles
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const container = navigationRef.current?.querySelector<HTMLElement>('.view-tabs');
    if (!container) return;
    const revealActiveView = () => {
      const active = container.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) return;
      const bounds = container.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      if (item.left < bounds.left) container.scrollLeft -= bounds.left - item.left;
      else if (item.right > bounds.right) container.scrollLeft += item.right - bounds.right;
    };
    revealActiveView();
    const observer = new ResizeObserver(revealActiveView);
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeView]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);
  const runAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };
  return (
    <header className="workspace-header">
      <button className="mobile-only icon-button workspace-sidebar-toggle" aria-label={t('Eszköztár megnyitása')} onClick={() => runAction(onOpenSidebar)}>
        <Menu size={21} />
      </button>
      <div className="workspace-navigation" ref={navigationRef}>{navigation}</div>
      {contextActions}
      <div className="header-actions">
        <div className="undo-group">
          <button
            className="icon-button"
            aria-label={t('Visszavonás')}
            disabled={!canUndo}
            onClick={() => runAction(onUndo)}
          >
            <Undo2 size={18} />
          </button>
          <button className="icon-button" aria-label={t('Újra')} disabled={!canRedo} onClick={() => runAction(onRedo)}>
            <Redo2 size={18} />
          </button>
        </div>
        <button className="quiet save-version-button" aria-label={t('Verzió mentése')} title={t('Verzió mentése')} onClick={() => runAction(onSaveVersion)}>
          <Save size={16} />
          <span>{t('Verzió mentése')}</span>
        </button>
        <div className="export-dropdown">
          <button className="primary" aria-label={t('Mentés és export')} title={t('Mentés és export')} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
            <ArrowUpRight size={16} />
            <span>{t('Mentés és export')}</span>
            <ChevronDown size={14} />
          </button>
          {menuOpen && (
            <>
              <button
                className="menu-backdrop"
                aria-label={t('Exportmenü bezárása')}
                onClick={() => setMenuOpen(false)}
              />
              <div className="dropdown-menu">
                {onConnectFile && (
                  <button onClick={() => runAction(onConnectFile)}>
                    <Save size={17} />
                    <span>
                      {t('Automatikus mentés fájlba…')}
                      <small>{t('Teljes projektarchívum')}</small>
                    </span>
                  </button>
                )}
                <button onClick={() => runAction(onExportProject)}>
                  <Save size={17} />
                  <span>
                    {t('Projektfájl mentése')}
                    <small>{t('Teljes terv, fotók és előzmények')}</small>
                  </span>
                </button>
                <button onClick={() => runAction(onExportClientPdf)}>
                  <FileText size={17} />
                  <span>
                    {t('PDF a megrendelőnek')}
                    <small>{t('Áttekinthető terv és jelmagyarázat')}</small>
                  </span>
                </button>
                <button onClick={() => runAction(onExportProfessionalPdf)}>
                  <FileText size={17} />
                  <span>
                    {t('Részletes szakmai PDF')}
                    <small>{t('Áramkörök, eszközök és elosztó')}</small>
                  </span>
                </button>
                <button onClick={() => runAction(onOpenDrive)}>
                  <Cloud size={17} />
                  <span>
                    {t('Google Drive')}
                    <small>{t('Saját felhős tárhely')}</small>
                  </span>
                </button>
                <button onClick={() => runAction(onOpenFiles)}>
                  <FolderOpen size={17} />
                  <span>{t('Megnyitás és importálás')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
