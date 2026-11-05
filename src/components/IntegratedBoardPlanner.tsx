import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectData } from '../types';
import { applyBoardPlannerSnapshot } from '../services/plannerBridge';
import { useLanguage } from '../i18n';
import './integrated-board-planner.css';

interface Props {
  data: ProjectData;
  getCurrentData: () => ProjectData | undefined;
  initialView?: 'cab' | 'sld';
  onChange: (data: ProjectData) => void;
  onNotify: (message: string) => void;
}

/** Keeps the cabinet drawing in the active project, rather than in the frame's local storage. */
export function IntegratedBoardPlanner({ data, getCurrentData, initialView = 'cab', onChange, onNotify }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const dataRef = useRef(data);
  const changeRef = useRef(onChange);
  const getCurrentDataRef = useRef(getCurrentData);
  const notifyRef = useRef(onNotify);
  const initialized = useRef(false);
  const generation = useRef(0);
  const lastSequence = useRef(0);
  const blocked = useRef(false);
  const [failed, setFailed] = useState(false);
  const snapshotSent = useRef('');
  const circuitsSent = useRef('');
  const { language } = useLanguage();
  dataRef.current = data;
  changeRef.current = onChange;
  getCurrentDataRef.current = getCurrentData;
  notifyRef.current = onNotify;

  const initialize = useCallback(() => {
    const current = getCurrentDataRef.current();
    const target = frame.current?.contentWindow;
    if (!target || !current || current.id !== dataRef.current.id) return;
    generation.current += 1;
    lastSequence.current = 0;
    target.postMessage({ type: 'voltgecko:initialize', projectId: current.id, projectName: current.name,
      generation: generation.current, snapshot: current.boardPlanner ?? null, circuits: current.circuits }, window.location.origin);
    if (!initialized.current) target.postMessage({ type: 'voltgecko:view', projectId: current.id, view: initialView }, window.location.origin);
    snapshotSent.current = JSON.stringify(current.boardPlanner ?? null);
    circuitsSent.current = JSON.stringify(current.circuits);
    initialized.current = true;
  }, [initialView]);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'voltgecko:ready') {
        if (!initialized.current) initialize();
        return;
      }
      const current = getCurrentDataRef.current();
      if (!current || current.id !== dataRef.current.id || message.projectId !== current.id || message.generation !== generation.current) return;
      if (message.type === 'voltgecko:error') {
        blocked.current = true;
        setFailed(true);
        return;
      }
      if (message.type !== 'voltgecko:change' || blocked.current || !Number.isSafeInteger(message.sequence) || message.sequence <= lastSequence.current) return;
      try {
        const next = applyBoardPlannerSnapshot(current, message.snapshot);
        lastSequence.current = message.sequence;
        snapshotSent.current = JSON.stringify(next.boardPlanner ?? null);
        circuitsSent.current = JSON.stringify(next.circuits);
        dataRef.current = next;
        changeRef.current(next);
        // Always acknowledge the newest child snapshot, even when only the
        // geometry changed. An earlier acknowledgement may have been ignored
        // while the child had newer edits in flight.
        frame.current?.contentWindow?.postMessage({ type: 'voltgecko:circuits', projectId: next.id,
          generation: generation.current, ackSequence: message.sequence, circuits: next.circuits }, window.location.origin);
      } catch {
        blocked.current = true;
        setFailed(true);
        notifyRef.current(language === 'en' ? 'The board changes could not be saved.' : 'Az elosztó módosításait nem sikerült menteni.');
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [initialize, language]);

  useEffect(() => {
    if (!initialized.current || getCurrentDataRef.current() !== data) return;
    const snapshot = JSON.stringify(data.boardPlanner ?? null);
    if (snapshot !== snapshotSent.current) {
      initialize();
      return;
    }
    const circuits = JSON.stringify(data.circuits);
    if (circuits !== circuitsSent.current) {
      frame.current?.contentWindow?.postMessage({ type: 'voltgecko:circuits', projectId: data.id,
        generation: generation.current, ackSequence: lastSequence.current, circuits: data.circuits }, window.location.origin);
      circuitsSent.current = circuits;
    }
  }, [data, initialize]);

  if (failed) return <div className="integrated-board-error" role="alert">
    <p>{language === 'en' ? 'The board drawing could not be loaded or saved. The stored project has not been replaced.' : 'Az elosztórajzot nem sikerült betölteni vagy menteni. A tárolt projekt nem lett felülírva.'}</p>
    <button onClick={() => { blocked.current = false; initialized.current = false; setFailed(false); }}>{language === 'en' ? 'Try again' : 'Újrapróbálás'}</button>
  </div>;
  return <iframe ref={frame} className="integrated-board-frame" title={language === 'en' ? 'Distribution board planner' : 'Elosztótervező'}
    src={`${import.meta.env.BASE_URL}board-planner.html`} onLoad={() => { initialized.current = false; initialize(); }} />;
}
