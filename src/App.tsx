import { lazy, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  FileImage,
  FileText,
  FolderOpen,
  LoaderCircle,
  MousePointer2,
  PencilRuler,
  Plus,
  Settings2,
  SlidersHorizontal,
  WifiOff,
  X,
  Zap
} from 'lucide-react';
import { APP, isProjectFilename } from './config';
import { t, useLanguage, getLocale } from './i18n';
import { catalogEntryId, makeDevice, uid } from './catalog';
import type { CatalogEntry, DeviceKind, Point, ProjectDocument } from './types';
import { checkpoint, createProject, deleteDevice, resolveImport } from './data/project';
import { deleteProject, loadProject, saveProject } from './data/storage';
import { assetFromFile, decodeProject, saveProjectFile } from './data/archive';
import type { FloorPlanProps } from './components/FloorPlan';
import { Brand } from './components/Brand';
import { StartScreen, NewProjectForm } from './components/StartScreen';
import { ReleaseInfo } from './components/ReleaseInfo';
import { LinkedFileControl, type LinkedFileActions } from './components/LinkedFileControl';
import { projectFilePicker } from './services/linkedFile';
import { downloadBlob, safeFilename } from './services/files';
import { addProductToProject } from './products/factory';
import type { CatalogProduct } from './products/types';
import { useProjectDocument } from './app/useProjectDocument';
import { useFocusTrap } from './app/useFocusTrap';
import { formatDate as fmt, errorMessage } from './app/format';
import { HelpPanel } from './app/HelpPanel';
import { HistoryView } from './app/HistoryView';
import { ProjectSettings } from './app/ProjectSettings';
import { ProjectBrowser } from './app/ProjectBrowser';
import { placeBoardDevice } from './data/boardPlacement';
import { DEFAULT_PLAN_IMAGE_SIZE } from './data/planAppearance';
import { addPlanBackgrounds } from './data/planBackground';
import { WorkspaceHeader } from './app/WorkspaceHeader';
import { getNavigation, type View } from './app/navigation';
import { LazyFeature } from './app/LazyFeature';
type Modal = 'projects' | 'new-project' | 'files' | 'settings' | 'help' | 'drive' | null;
type Tool = FloorPlanProps['tool'];
const FloorPlan = lazy(() => import('./components/FloorPlan').then((module) => ({ default: module.FloorPlan })));
const BoardEditor = lazy(() => import('./components/BoardEditor').then((module) => ({ default: module.BoardEditor })));
const SingleLine = lazy(() => import('./components/SingleLine').then((module) => ({ default: module.SingleLine })));
const Circuits = lazy(() => import('./components/Circuits').then((module) => ({ default: module.Circuits })));
const Inspector = lazy(() => import('./components/Inspector').then((module) => ({ default: module.Inspector })));
const ManufacturerLibrary = lazy(() => import('./app/ManufacturerLibrary'));
const EditorSidebar = lazy(() => import('./app/EditorSidebar').then((module) => ({ default: module.EditorSidebar })));
const DrivePanel = lazy(() => import('./app/DrivePanel').then((module) => ({ default: module.DrivePanel })));

const importBackground: typeof import('./services/import').importBackground = async (file) =>
  (await import('./services/import')).importBackground(file);
const exportPdf: typeof import('./services/pdf').exportPdf = async (doc, audience) =>
  (await import('./services/pdf')).exportPdf(doc, audience);
export default function App() {
  const { language } = useLanguage();
  const [view, setView] = useState<View>('floor');
  const [sheetId, setSheetId] = useState('');
  const [boardId, setBoardId] = useState('');
  const [productLibraryOpen, setProductLibraryOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [catalogEntry, setCatalogEntry] = useState<CatalogEntry>();
  const [modal, setModal] = useState<Modal>(null);
  const [sidebar, setSidebar] = useState(false);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  useEffect(() => {
    setToast('');
  }, [language]);
  const [online, setOnline] = useState(navigator.onLine);
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const busyRef = useRef('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateFn = useRef<(() => Promise<void>) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const linkedFileActions = useRef<LinkedFileActions>(null);
  const modalRegion = useRef<HTMLElement>(null);
  const busyRegion = useRef<HTMLDivElement>(null);
  const notify = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  };
  const {
    doc,
    docRef,
    setDoc,
    projects,
    loading,
    fatal,
    saveState,
    refreshProjects,
    switchDocument: activateDocument,
    saveCurrent,
    changeData,
    saveVersion: checkpointVersion,
    restoreVersion,
    canUndo,
    canRedo,
    goUndo: undoChange,
    goRedo
  } = useProjectDocument(notify);
  const switchDocument = (next: ProjectDocument) => {
    activateDocument(next);
    setSheetId(next.data.sheets[0]?.id ?? '');
    setBoardId(next.data.boards[0]?.id ?? '');
    setSelectedId(null);
    setTool('select');
    setModal(null);
    setSidebar(false);
  };
  const goUndo = () => {
    undoChange();
    setSelectedId(null);
  };
  const perform = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = label;
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      notify(errorMessage(e));
    } finally {
      busyRef.current = '';
      setBusy('');
    }
  };
  useFocusTrap(
    busy ? busyRegion : modalRegion,
    busy || modal,
    modal === 'new-project' && !busy ? '#new-project-name' : undefined
  );
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    const update = (event: Event) => {
      updateFn.current = (event as CustomEvent).detail;
      setUpdateAvailable(true);
    };
    window.addEventListener('app-update', update);
    if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(() => setOfflineReady(true)).catch(() => {});
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
      window.removeEventListener('app-update', update);
    };
  }, []);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (busyRef.current) return;
        const d = docRef.current;
        if (d) {
          const next = checkpoint(d, t('Gyors mentés'));
          setDoc(next);
          notify(t('Új változat elmentve.'));
        }
        return;
      }
      if (busyRef.current) return;
      if (e.key === 'Escape') {
        setModal(null);
        setProductLibraryOpen(false);
        setSidebar(false);
        setTool('select');
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const newProject = async (name: string) => {
    if (!name.trim()) return;
    await saveCurrent();
    const next = createProject(name.trim());
    await saveProject(next);
    switchDocument(next);
    setView('floor');
    await refreshProjects();
  };
  const openLocalProject = async (id: string) => {
    await saveCurrent();
    const loaded = await loadProject(id);
    if (!loaded) throw new Error(t('A projekt már nem található ezen az eszközön.'));
    switchDocument(loaded);
    setView('floor');
  };
  const tryDemo = async () => {
    await saveCurrent();
    const { createDemoProject } = await import('./data/demo');
    const demo = createDemoProject();
    await saveProject(demo);
    switchDocument(demo);
    setView('floor');
    await refreshProjects();
  };
  const showStart = async () => {
    await saveCurrent();
    await refreshProjects();
    setModal(null);
    setSidebar(false);
    setProductLibraryOpen(false);
    setSelectedId(null);
    activateDocument(null);
  };
  const loadImported = async (incoming: ProjectDocument) => {
    await saveCurrent();
    const existing = await loadProject(incoming.data.id);
    const result = resolveImport(incoming, existing);
    await saveProject(result.document);
    switchDocument(result.document);
    setView('floor');
    await refreshProjects();
    notify(result.message);
  };
  const importFile = (file: File) =>
    perform(t('Projekt megnyitása…'), async () => {
      if (!isProjectFilename(file.name)) throw new Error(t('Csak .vgecko projektfájl nyitható meg.'));
      await loadImported(await decodeProject(file));
    });
  const exportFile = () => {
    if (!doc) return;
    void perform(t('Projektfájl készítése…'), async () => {
      const next = checkpoint(doc, t('Projektfájl mentése'));
      setDoc(next);
      await saveProjectFile(next);
      const saved = { ...next, lastExternalSaveAt: new Date().toISOString() };
      setDoc(saved);
      await saveProject(saved);
      notify(t('A teljes projektfájl elkészült, az előzményekkel és mellékletekkel.'));
    });
  };
  const addBackground = (files: FileList | File[], targetSheetId = sheetId) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    void perform(t('Alaprajz feldolgozása…'), async () => {
      const results = [];
      for (const file of selected) results.push(...(await importBackground(file)));
      const current = docRef.current;
      if (!current) return;
      const { data, assets, firstSheetId } = addPlanBackgrounds(current, results, targetSheetId);
      changeData(data, assets);
      setSheetId(firstSheetId ?? sheetId);
      setSelectedId(null);
      setTool('select');
      setView('floor');
      notify(t('{p0} tervlap hozzáadva.', { p0: results.length }));
    });
  };
  const addManufacturerProduct = (product: CatalogProduct) => {
    const current = docRef.current;
    if (!current) return;
    try {
      const result = addProductToProject(current.data, product, boardId);
      changeData(result.data);
      setBoardId(result.boardId);
      setView('board');
      setTool('select');
      setSelectedId(result.selectedId);
      setSidebar(false);
      notify(
        result.placed
          ? t('{reference} hozzáadva.', { reference: product.reference })
          : t('Nincs elegendő szabad modulhely. A készülék az eszközlistában megmaradt, elhelyezésre vár.')
      );
    } catch (error) {
      notify(errorMessage(error));
    }
  };
  const addDevice = (kind: DeviceKind, targetSheetId: string, point: Point) => {
    if (!doc) return;
    const next = structuredClone(doc.data);
    const d = makeDevice(kind, next.devices, catalogEntry?.kind === kind ? catalogEntry.variant : undefined);
    next.devices.push(d);
    const sheet = next.sheets.find((s) => s.id === targetSheetId);
    sheet?.placements.push({ deviceId: d.id, x: point.x, y: point.y, rotation: 0 });
    changeData(next);
    setSelectedId(d.id);
    setTool('select');
  };
  const chooseCatalog = (entry: CatalogEntry) => {
    if (!doc) return;
    const { kind, variant } = entry;
    setCatalogEntry(entry);
    if (view !== 'board') {
      setView('floor');
      setTool(kind);
      setSidebar(false);
      notify(t('Érintsd meg az eszköz helyét az alaprajzon.'));
      return;
    }
    let next = structuredClone(doc.data);
    const device = makeDevice(kind, next.devices, variant);
    next.devices.push(device);
    const board = next.boards.find((candidate) => candidate.id === boardId) ?? next.boards[0];
    if (board?.rows[0]) next = placeBoardDevice(next, board.id, board.rows[0].id, device.id);
    changeData(next);
    setSelectedId(device.id);
    setSidebar(false);
  };
  const addPhoto = (files: FileList) => {
    const id = selectedId;
    void perform(t('Fotók mentése…'), async () => {
      const photos = [];
      for (const file of Array.from(files)) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
          throw new Error(t('PNG, JPG vagy WebP fotó választható.'));
        if (file.size > 15 * 1024 * 1024) throw new Error(t('Egy fotó legfeljebb 15 MB lehet.'));
        photos.push(await assetFromFile(file));
      }
      const current = docRef.current;
      if (!current) return;
      const data = structuredClone(current.data);
      const assets = { ...current.assets };
      const d = data.devices.find((d) => d.id === id);
      if (!d) return;
      photos.forEach((a) => {
        assets[a.id] = a;
        if (!d.photoIds.includes(a.id)) d.photoIds.push(a.id);
      });
      changeData(data, assets);
      notify(t('A fotók a helyi projekthez kerültek.'));
    });
  };
  const addPlanImage = (file: File) => {
    const id = selectedId, projectId = docRef.current?.data.id;
    if (!id || !projectId) return;
    void perform(t('Alaprajzi kép mentése…'), async () => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error(t('PNG, JPG vagy WebP kép választható.'));
      if (file.size > 15 * 1024 * 1024) throw new Error(t('Egy alaprajzi kép legfeljebb 15 MB lehet.'));
      const asset = await assetFromFile(file);
      const { imageSize } = await import('./services/import');
      const dimensions = await imageSize(asset.data);
      if (!dimensions.width || !dimensions.height) throw new Error(t('A kép mérete érvénytelen.'));
      const current = docRef.current;
      if (!current || current.data.id !== projectId) return;
      const data = structuredClone(current.data);
      const device = data.devices.find((item) => item.id === id);
      if (!device) return;
      device.planImage = { assetId: asset.id, size: device.planImage?.size ?? DEFAULT_PLAN_IMAGE_SIZE, opacity: device.planImage?.opacity ?? 1 };
      changeData(data, { ...current.assets, [asset.id]: asset });
      notify(t('Az alaprajzi kép a projekthez került.'));
    });
  };
  const removeDevice = (id: string) => {
    if (!doc || !confirm(t('Törlöd ezt az eszközt és a hozzá tartozó rajzi kapcsolatokat? A művelet visszavonható.')))
      return;
    changeData(deleteDevice(doc.data, id));
    setSelectedId(null);
  };
  const locate = (id: string) => {
    if (!doc) return;
    const s = doc.data.sheets.find((s) => s.placements.some((p) => p.deviceId === id));
    if (s) {
      setSheetId(s.id);
      setView('floor');
    } else {
      const b = doc.data.boards.find((b) => b.rows.some((r) => r.placements.some((p) => p.deviceId === id)));
      if (b) {
        setBoardId(b.id);
        setView('board');
      }
    }
    setSelectedId(id);
    setSidebar(false);
  };
  const saveVersion = (note = t('Mentett változat')) => {
    checkpointVersion(note);
    notify(t('A változat bekerült az előzményekbe.'));
  };
  const openDrive = () => setModal('drive');
  if (fatal)
    return (
      <div className="boot-screen">
        <WifiOff size={40} />
        <h1>{t('A helyi tárhely nem érhető el')}</h1>
        <p>{fatal}</p>
        <p>{t('Normál böngészőablakban engedélyezd a webhely adattárolását.')}</p>
        <button className="primary" onClick={() => location.reload()}>
          {t('Újrapróbálás')}
        </button>
      </div>
    );
  if (loading)
    return (
      <div className="boot-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>{t('A helyi munkatér megnyitása…')}</p>
      </div>
    );
  const data = doc?.data;
  const sheet = data?.sheets.find((s) => s.id === sheetId) ?? data?.sheets[0];
  const device = data?.devices.find((d) => d.id === selectedId) ?? null;
  let standaloneDraft: string | null = null;
  try { standaloneDraft = localStorage.getItem('eloszto-tervezo-v2'); } catch { /* Storage may be unavailable. */ }
  const nav = getNavigation();
  return (
    <>
      {!doc && (
        <StartScreen
          projects={projects}
          busy={Boolean(busy)}
          online={online}
          offlineReady={offlineReady}
          onCreate={(name) => void perform(t('Új projekt…'), () => newProject(name))}
          onOpenFile={() => fileInput.current?.click()}
          onOpenProject={(id) => void perform(t('Projekt megnyitása…'), () => openLocalProject(id))}
          onTryDemo={() => void perform(t('Mintaprojekt…'), tryDemo)}
          onOpenDrive={openDrive}
          onUpdate={
            updateAvailable
              ? () =>
                  void perform(t('Frissítés'), async () => {
                    await updateFn.current?.();
                  })
              : undefined
          }
        />
      )}
      {doc && data && (
        <div className={`app-shell ${sidebar ? 'sidebar-open' : ''} ${selectedId ? 'selection-open' : ''}`}>
          <LazyFeature errorClassName="sidebar" fallback={<aside className="sidebar" role="status">{t('Betöltés…')}</aside>}><EditorSidebar
            document={doc}
            view={view}
            tool={tool}
            selectedCatalogId={catalogEntry ? catalogEntryId(catalogEntry) : undefined}
            selectedId={selectedId}
            onViewChange={(view) => {
              setView(view);
              setTool('select');
              setSidebar(false);
            }}
            onClose={() => setSidebar(false)}
            onProjectsOpen={() => {
              setModal('projects');
              void perform(t('Projekt megnyitása…'), refreshProjects);
            }}
            onProductsOpen={() => {
              setProductLibraryOpen(true);
              setSidebar(false);
            }}
            onHelpOpen={() => setModal('help')}
            onChooseCatalog={chooseCatalog}
            onLocate={locate}
          /></LazyFeature>

          {sidebar && (
            <button
              className="sidebar-backdrop"
              aria-label={t('Eszköztár bezárása')}
              onClick={() => setSidebar(false)}
            />
          )}
          <main className="workspace">
            <WorkspaceHeader
              projectName={data.name}
              canUndo={canUndo}
              canRedo={canRedo}
              onOpenSidebar={() => setSidebar(true)}
              onOpenSettings={() => setModal('settings')}
              onHome={() => void perform(t('Mentés és kezdőképernyő…'), showStart)}
              onUndo={goUndo}
              onRedo={goRedo}
              onSaveVersion={() => saveVersion()}
              onConnectFile={projectFilePicker() ? () => linkedFileActions.current?.connect() : undefined}
              onExportProject={exportFile}
              onExportClientPdf={() => void perform(t('Ügyfél-PDF készítése…'), () => exportPdf(doc, 'client'))}
              onExportProfessionalPdf={() =>
                void perform(t('Részletes PDF készítése…'), () => exportPdf(doc, 'professional'))
              }
              onOpenDrive={openDrive}
              onOpenFiles={() => setModal('files')}
            />
            {updateAvailable && (
              <div className="update-banner">
                <span>{t('Új alkalmazásverzió érhető el.')}</span>
                <button
                  onClick={() =>
                    void perform(t('Mentés és frissítés…'), async () => {
                      await saveProject(doc);
                      await updateFn.current?.();
                    })
                  }
                >
                  {t('Mentés és frissítés')}
                </button>
              </div>
            )}
            <LinkedFileControl key={doc.data.id} ref={linkedFileActions} document={doc} onNotify={notify} />
            <div className="workspace-toolbar">
              <div className="view-tabs">
                {nav
                  .filter((n) => n.id !== 'history')
                  .map((n) => (
                    <button
                      className={view === n.id ? 'active' : ''}
                      key={n.id}
                      onClick={() => {
                        setView(n.id);
                        setTool('select');
                      }}
                    >
                      <n.icon size={16} />
                      {n.label}
                    </button>
                  ))}
              </div>
              <div className="toolbar-right">
                {view === 'board' && (
                  <button
                    className="quiet"
                    aria-label={t('Schneider terméktár')}
                    onClick={(event) => {
                      event.currentTarget.focus();
                      setProductLibraryOpen(true);
                    }}
                  >
                    <BookOpen size={16} />
                    <span>{t('Schneider terméktár')}</span>
                  </button>
                )}
                {view === 'floor' && (
                  <>
                    <button className="quiet" onClick={() => backgroundInput.current?.click()}>
                      <FileImage size={16} />
                      <span>{t('Alaprajz betöltése')}</span>
                    </button>
                    <button
                      className="icon-button"
                      title={t('Üres tervlap hozzáadása')}
                      aria-label={t('Üres tervlap hozzáadása')}
                      onClick={() => {
                        const name = prompt(t('Az új tervlap neve:'), t('Új tervlap'));
                        if (!name?.trim()) return;
                        const id = uid();
                        changeData({
                          ...data,
                          sheets: [
                            ...data.sheets,
                            {
                              id,
                              name: name.trim(),
                              width: 1200,
                              height: 800,
                              placements: [],
                              routes: [],
                              annotations: []
                            }
                          ]
                        });
                        setSheetId(id);
                      }}
                    >
                      <Plus size={17} />
                    </button>
                  </>
                )}
                <button
                  className="icon-button"
                  aria-label={t('Projektbeállítások')}
                  onClick={() => setModal('settings')}
                >
                  <SlidersHorizontal size={17} />
                </button>
              </div>
            </div>
            {view === 'floor' && (
              <div className="plan-heading">
                <div>
                  <span className="eyebrow">{t('VILLAMOS ELHELYEZÉSI TERV')}</span>
                  <select
                    aria-label={t('Aktív tervlap')}
                    value={sheet?.id ?? ''}
                    onChange={(e) => {
                      setSheetId(e.target.value);
                      setSelectedId(null);
                    }}
                  >
                    {data.sheets.map((s) => (
                      <option value={s.id} key={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="sheet-count">
                  {t('{count} eszköz', { count: sheet?.placements.length ?? 0 })}
                  <span>·</span>{' '}
                  {sheet?.mmPerUnit
                    ? t('1 egység = {p0} mm', {
                        p0: sheet.mmPerUnit.toLocaleString(getLocale(), { maximumFractionDigits: 2 })
                      })
                    : t('Méretarány nincs beállítva')}
                </span>
              </div>
            )}
            <div className={`editor-area ${view === 'floor' ? 'floor-area' : ''}`}>
              <LazyFeature key={view}>
                {view === 'floor' &&
                  (sheet ? (
                    <FloorPlan
                      key={sheet.id}
                      data={data}
                      assets={doc.assets}
                      sheetId={sheet.id}
                      selectedId={selectedId}
                      tool={tool}
                      onSelect={setSelectedId}
                      onChange={changeData}
                      onAddDevice={addDevice}
                      deviceToolLabel={catalogEntry?.label}
                      onNotify={notify}
                      onUploadBackground={() => backgroundInput.current?.click()}
                      onDropBackground={(files) => addBackground(files, sheet.id)}
                      tools={
                        <div className="drawing-tools" aria-label={t('Rajzeszközök')}>
                          {[
                            { id: 'select', icon: MousePointer2, label: t('Kijelölés és mozgatás') },
                            { id: 'route', icon: Zap, label: t('Kapcsolat / nyomvonal') },
                            { id: 'control', icon: Settings2, label: t('Vezérlési kapcsolat') },
                            { id: 'note', icon: FileText, label: t('Megjegyzés a rajzon') },
                            { id: 'scale', icon: PencilRuler, label: t('Méretarány beállítása') }
                          ].map((drawingTool) => (
                            <button
                              key={drawingTool.id}
                              aria-label={drawingTool.label}
                              title={drawingTool.label}
                              className={tool === drawingTool.id ? 'active' : ''}
                              onClick={() => {
                                setTool(drawingTool.id as Tool);
                                if (drawingTool.id !== 'select') setSelectedId(null);
                                if (drawingTool.id === 'route' || drawingTool.id === 'control')
                                  notify(t('Válaszd ki a kapcsolat két eszközét.'));
                                if (drawingTool.id === 'scale')
                                  notify(t('Jelölj ki két pontot egy ismert távolsághoz.'));
                              }}
                            >
                              <drawingTool.icon size={19} />
                            </button>
                          ))}
                        </div>
                      }
                    />
                  ) : (
                    <div className="empty">
                      <FileImage size={40} />
                      <h2>{t('Kezdj egy alaprajzzal')}</h2>
                      <p>{t('Tölts be PDF-et vagy képet, vagy hozz létre üres tervlapot.')}</p>
                      <button className="primary" onClick={() => backgroundInput.current?.click()}>
                        {t('Alaprajz betöltése')}
                      </button>
                    </div>
                  ))}
                {view === 'board' && (
                  <div className="integrated-board-view">
                    {(data.boardPlanner || standaloneDraft) && <div className="integrated-board-line-notice" role="status">
                      <p>{language === 'en'
                        ? 'A drawing from the temporary standalone editor is preserved separately. It is not part of this board or its PDF. Download it before making changes; it is not converted automatically.'
                        : 'Az átmeneti önálló tervező rajza külön megmaradt. Nem része ennek az elosztónak és a PDF-nek. Töltsd le megőrzésre; nem alakítjuk át automatikusan.'}</p>
                      {data.boardPlanner && <button onClick={() => downloadBlob(new Blob([JSON.stringify(data.boardPlanner, null, 2)], { type: 'application/json' }), `${safeFilename(data.name)}-korabbi-elosztoterv.json`)}>
                        {language === 'en' ? 'Download project drawing' : 'Projektben őrzött rajz letöltése'}
                      </button>}
                      {standaloneDraft && <button onClick={() => downloadBlob(new Blob([standaloneDraft!], { type: 'application/json' }), `${safeFilename(data.name)}-korabbi-onallo-rajz.json`)}>
                        {language === 'en' ? 'Download browser drawing' : 'Böngészőben őrzött rajz letöltése'}
                      </button>}
                    </div>}
                    <div className="integrated-board-classic"><BoardEditor data={data} boardId={boardId} onBoardChange={setBoardId}
                      selectedId={selectedId} onSelect={setSelectedId} onChange={changeData} onNotify={notify} /></div>
                  </div>
                )}
                {view === 'single-line' && <SingleLine data={data} boardId={boardId} onBoardChange={setBoardId} onSelect={setSelectedId} />}
                {view === 'circuits' && <Circuits data={data} onChange={changeData} onSelect={setSelectedId} />}
                {view === 'history' && (
                  <HistoryView
                    key={doc.data.id}
                    document={doc}
                    onSave={saveVersion}
                    onRestore={(id) => {
                      restoreVersion(id);
                      setSelectedId(null);
                      notify(t('Új változat készült a visszaállított állapotból.'));
                    }}
                  />
                )}
              </LazyFeature>
            </div>
            <footer className="statusbar">
              <span className={saveState === 'error' ? 'danger-text' : ''}>
                {saveState === 'saving' ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{' '}
                {saveState === 'saving'
                  ? t('Helyi mentés…')
                  : saveState === 'error'
                    ? t('Mentési hiba')
                    : t('Ezen az eszközön mentve')}
              </span>
              <span className="external-status">
                {t('Fájl:')} {fmt(doc.lastExternalSaveAt)} <span>·</span>
                {t('Drive:')} {fmt(doc.lastDriveSaveAt)}
              </span>
              <span>
                {!online ? (
                  <>
                    <WifiOff size={13} />
                    {t('Offline')}
                  </>
                ) : (
                  <>
                    <span className="local-dot" />
                    {offlineReady ? t('Offline használatra kész') : t('Helyi fejlesztés')}
                  </>
                )}
              </span>
              <ReleaseInfo compact />
            </footer>
          </main>
          <LazyFeature fallback={null}>
            <Inspector
              data={data}
              assets={doc.assets}
              device={device}
              boardId={view === 'board' ? boardId : undefined}
              onChange={changeData}
              onNotify={notify}
              onClose={() => setSelectedId(null)}
              onDelete={removeDevice}
              onPhoto={addPhoto}
              onPlanImage={addPlanImage}
              onLocate={locate}
            />
          </LazyFeature>
        </div>
      )}
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept=".vgecko"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={backgroundInput}
        className="hidden"
        type="file"
        accept="application/pdf,image/png,image/jpeg"
        multiple
        onChange={(e) => {
          if (e.target.files) addBackground(e.target.files);
          e.target.value = '';
        }}
      />
      {toast && (
        <div role="status" className="toast">
          <Check size={17} />
          <span>{toast}</span>
          <button className="icon-button" aria-label={t('Értesítés bezárása')} onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div ref={busyRegion} className="busy-overlay" role="status" tabIndex={-1}>
          <LoaderCircle className="spin" size={25} />
          <span>{busy}</span>
        </div>
      )}
      {productLibraryOpen && (
        <LazyFeature onClose={() => setProductLibraryOpen(false)}>
          <ManufacturerLibrary onAdd={addManufacturerProduct} onClose={() => setProductLibraryOpen(false)} />
        </LazyFeature>
      )}
      {modal && (
        <div
          className="modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            ref={modalRegion}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            aria-label={
              {
                projects: t('Projektek'),
                'new-project': t('Új projekt'),
                files: t('Megnyitás és importálás'),
                settings: t('Projektbeállítások'),
                help: t('Útmutató és adatkezelés'),
                drive: t('Google Drive')
              }[modal]
            }
            className={`modal modal-${modal}`}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">{t(APP.name)}</span>
                <h2>
                  {
                    {
                      projects: t('Saját projektek'),
                      'new-project': t('Új projekt'),
                      files: t('Megnyitás és importálás'),
                      settings: t('Projektbeállítások'),
                      help: t('Jó tervvel könnyebb a helyszínen.'),
                      drive: t('Google Drive')
                    }[modal]
                  }
                </h2>
              </div>
              <button className="icon-button" aria-label={t('Ablak bezárása')} onClick={() => setModal(null)}>
                <X size={21} />
              </button>
            </div>
            {modal === 'new-project' && (
              <NewProjectForm
                onCreate={(name) => void perform(t('Új projekt…'), () => newProject(name))}
                onCancel={() => setModal('projects')}
                disabled={Boolean(busy)}
              />
            )}
            {modal === 'projects' && (
              <ProjectBrowser
                projects={projects}
                activeId={data?.id}
                onCreate={() => setModal('new-project')}
                onFiles={() => setModal('files')}
                onDemo={() => void perform(t('Mintaprojekt…'), tryDemo)}
                onOpen={(id) => void perform(t('Projekt megnyitása…'), () => openLocalProject(id))}
                onDelete={(id) =>
                  void perform(t('Projekt törlése…'), async () => {
                    await deleteProject(id);
                    await refreshProjects();
                  })
                }
              />
            )}
            {modal === 'files' && (
              <div className="import-options">
                <button onClick={() => fileInput.current?.click()}>
                  <FolderOpen size={27} />
                  <strong>{t('Projektfájl megnyitása')}</strong>
                  <span>{t('.vgecko · teljes projektarchívum')}</span>
                </button>
                <button onClick={() => backgroundInput.current?.click()}>
                  <FileImage size={27} />
                  <strong>{t('Alaprajz betöltése')}</strong>
                  <span>{t('PDF, PNG vagy JPG · új tervlapként')}</span>
                </button>
              </div>
            )}
            {modal === 'settings' && data && (
              <ProjectSettings
                data={data}
                sheet={sheet}
                onChange={changeData}
                onSheetChange={setSheetId}
                onClose={() => setModal(null)}
              />
            )}
            {modal === 'help' && <HelpPanel perform={perform} notify={notify} />}
            {modal === 'drive' && (
              <LazyFeature>
                <DrivePanel
                  document={doc}
                  online={online}
                  perform={perform}
                  onDocumentChange={setDoc}
                  onImport={loadImported}
                  onExport={exportFile}
                  onNotify={notify}
                />
              </LazyFeature>
            )}
          </section>
        </div>
      )}
    </>
  );
}
