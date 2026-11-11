import { useCallback, useEffect, useRef, useState } from 'react';
import { checkpoint, restoreRevision } from '../data/project';
import { pruneInvalidBoardRouteTerminals } from '../data/boardRouteConnections';
import { listProjects, saveProject } from '../data/storage';
import { t } from '../i18n';
import type { ProjectData, ProjectDocument, ProjectSummary } from '../types';

const HISTORY_LIMIT = 50;

export function useProjectDocument(notify: (message: string) => void) {
  const [doc, renderDocument] = useState<ProjectDocument | null>(null);
  const docRef = useRef(doc);
  const savedRef = useRef(doc);
  const undo = useRef<ProjectData[]>([]);
  const redo = useRef<ProjectData[]>([]);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [saveState, setSaveState] = useState<'saving' | 'saved' | 'error'>('saving');

  // Event handlers and asynchronous file operations must see a change immediately,
  // including multiple changes before React renders the next frame.
  const setDoc = useCallback((next: ProjectDocument | null) => {
    docRef.current = next;
    renderDocument(next);
  }, []);

  const refreshProjects = async () => setProjects(await listProjects());

  useEffect(() => {
    let cancelled = false;
    listProjects()
      .then((all) => {
        if (!cancelled) {
          setProjects(all);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) setFatal(error instanceof Error ? error.message : t('A művelet nem sikerült.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!doc) return;
    setSaveState('saving');
    void saveProject(doc)
      .then(() => {
        if (docRef.current === doc) {
          savedRef.current = doc;
          setSaveState('saved');
        }
      })
      .catch((error) => {
        if (docRef.current !== doc) return;
        setSaveState('error');
        notifyRef.current(
          t('Helyi mentési hiba: {p0}. Ments projektfájlt.', {
            p0: error instanceof Error ? error.message : t('A művelet nem sikerült.')
          })
        );
      });
  }, [doc]);

  useEffect(() => {
    const preventUnsaved = (event: BeforeUnloadEvent) => {
      if (docRef.current && docRef.current !== savedRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', preventUnsaved);
    return () => window.removeEventListener('beforeunload', preventUnsaved);
  }, []);

  const resetHistory = () => {
    undo.current = [];
    redo.current = [];
  };
  const switchDocument = (next: ProjectDocument | null) => {
    resetHistory();
    setDoc(next);
    if (next) localStorage.setItem('planner.activeProject', next.data.id);
    else localStorage.removeItem('planner.activeProject');
  };
  const saveCurrent = async () => {
    const current = docRef.current;
    if (current) {
      await saveProject(current);
      savedRef.current = current;
    }
  };
  const changeData = (data: ProjectData, assets?: ProjectDocument['assets']) => {
    const current = docRef.current;
    if (!current) return;
    undo.current.push(structuredClone(current.data));
    if (undo.current.length > HISTORY_LIMIT) undo.current.shift();
    redo.current = [];
    setDoc({ ...current, data: pruneInvalidBoardRouteTerminals(data), assets: assets ?? current.assets, updatedAt: new Date().toISOString() });
  };
  const moveHistory = (from: ProjectData[], to: ProjectData[]) => {
    const current = docRef.current;
    if (!current || !from.length) return;
    to.push(structuredClone(current.data));
    setDoc({ ...current, data: from.pop()!, updatedAt: new Date().toISOString() });
  };
  const saveVersion = (note: string) => {
    if (docRef.current) setDoc(checkpoint(docRef.current, note));
  };
  const restoreVersion = (id: string) => {
    if (!docRef.current) return;
    const current = checkpoint(docRef.current, t('Visszaállítás előtti állapot'));
    resetHistory();
    setDoc(restoreRevision(current, id));
  };

  return {
    doc,
    docRef,
    setDoc,
    projects,
    loading,
    fatal,
    saveState,
    refreshProjects,
    switchDocument,
    saveCurrent,
    changeData,
    saveVersion,
    restoreVersion,
    canUndo: undo.current.length > 0,
    canRedo: redo.current.length > 0,
    goUndo: () => moveHistory(undo.current, redo.current),
    goRedo: () => moveHistory(redo.current, undo.current)
  };
}
