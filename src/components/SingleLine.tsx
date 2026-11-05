import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Maximize2, Minus, Network, Plus } from 'lucide-react';
import { t, useLanguage } from '../i18n';
import { getBoardConnectionIssues } from '../data/boardConnections';
import { buildSingleLineSvg, buildProjectSingleLineSvg } from '../services/singleLine';
import { getWiringIssues } from '../data/boardWiring';
import { downloadBlob, safeFilename } from '../services/files';
import type { ProjectData } from '../types';

interface Props {
  data: ProjectData;
  boardId: string;
  onBoardChange: (id: string) => void;
  onSelect: (id: string) => void;
}
const clampZoom = (value: number): number => Math.min(2.5, Math.max(0.1, value));

export function SingleLine({ data, boardId, onBoardChange, onSelect }: Props) {
  const { language } = useLanguage();
  const [allBoards, setAllBoards] = useState(false),
    [exportError, setExportError] = useState('');
  const board = data.boards.find((item) => item.id === boardId) ?? data.boards[0];
  const drawing = useMemo(
    () => (board ? (allBoards ? buildProjectSingleLineSvg(data) : buildSingleLineSvg(data, board)) : undefined),
    [data, board, language, allBoards]
  );
  const issues = useMemo(
    () =>
      board
        ? (allBoards ? data.boards : [board]).flatMap((item) => [
            ...getBoardConnectionIssues(item, data.devices),
            ...getWiringIssues(data, item)
          ])
        : [],
    [board, data, language, allBoards]
  );
  const stage = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true);
  useEffect(() => {
    setFit(true);
    stage.current?.scrollTo({ top: 0, left: 0 });
  }, [board?.id]);
  useEffect(() => {
    const viewport = stage.current;
    if (!viewport || !drawing || !fit) return;
    // Fit the width and retain vertical scrolling so a long feed chain keeps readable labels.
    const resize = () => setZoom(clampZoom(Math.min(1, (viewport.clientWidth - 32) / drawing.width)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [drawing, fit]);
  const changeZoom = (multiplier: number) => {
    setFit(false);
    setZoom((current) => clampZoom(current * multiplier));
  };
  const selectFromSvg = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const id = target.closest('[data-device-id]')?.getAttribute('data-device-id');
    if (id && data.devices.some((device) => device.id === id)) onSelect(id);
  };
  const download = () => {
    if (!drawing || !board) return;
    const blob = new Blob([drawing.svg], { type: 'image/svg+xml;charset=utf-8' });
    downloadBlob(blob, `${safeFilename(allBoards ? data.name : board.name)}-single-line.svg`);
  };
  const downloadPng = async () => {
    if (!drawing || !board) return;
    setExportError('');
    const url = URL.createObjectURL(new Blob([drawing.svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const picture = new Image();
      picture.src = url;
      await picture.decode();
      // Bound canvas area on phones while preserving diagram aspect ratio.
      const scale = Math.min(
        2,
        8192 / drawing.width,
        8192 / drawing.height,
        Math.sqrt(24000000 / (drawing.width * drawing.height))
      );
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(drawing.width * scale));
      canvas.height = Math.max(1, Math.ceil(drawing.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('A PNG-export nem érhető el.'));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(picture, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error(t('A PNG-export nem érhető el.')))),
          'image/png'
        )
      );
      downloadBlob(blob, `${safeFilename(allBoards ? data.name : board.name)}-single-line.png`);
      canvas.width = 0;
      canvas.height = 0;
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  if (!board || !drawing)
    return (
      <div className="empty">
        <Network size={40} />
        <h2>{t('Egyvonalas rajz')}</h2>
        <p>{t('Előbb hozz létre egy elosztót az elosztónézetben.')}</p>
      </div>
    );
  return (
    <section className="single-line-view">
      <div className="single-line-heading">
        <div>
          <span className="eyebrow">{t('KAPCSOLATI NÉZET')}</span>
          <h2>{t('Egyvonalas rajz')}</h2>
          <p>{t('Az elosztóban megadott vezetékek és korábbi, részletezetlen kapcsolatok.')}</p>
        </div>
        <select
          aria-label={t('Egyvonalas rajz elosztója')}
          value={allBoards ? 'all' : board.id}
          onChange={(event) => {
            setAllBoards(event.target.value === 'all');
            if (event.target.value !== 'all') onBoardChange(event.target.value);
            setFit(true);
          }}
        >
          <option value="all">{t('Minden elosztó')}</option>
          {data.boards.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="single-line-toolbar">
        <div className="single-line-zoom">
          <button
            className="icon-button"
            aria-label={t('Rajz kicsinyítése')}
            title={t('Rajz kicsinyítése')}
            onClick={() => changeZoom(1 / 1.2)}
            disabled={zoom <= 0.1001}
          >
            <Minus size={17} />
          </button>
          <output aria-label={t('A rajz nagyítása')}>{Math.round(zoom * 100)}%</output>
          <button
            className="icon-button"
            aria-label={t('Rajz nagyítása')}
            title={t('Rajz nagyítása')}
            onClick={() => changeZoom(1.2)}
            disabled={zoom >= 2.499}
          >
            <Plus size={17} />
          </button>
          <button
            className="quiet"
            aria-label={t('Rajz illesztése')}
            onClick={() => {
              setFit(true);
              stage.current?.scrollTo({ top: 0, left: 0 });
            }}
          >
            <Maximize2 size={15} />
            <span>{t('Illesztés')}</span>
          </button>
        </div>
        <button className="quiet single-line-download" onClick={download}>
          <Download size={15} />
          {t('SVG letöltése')}
        </button>
        <button className="quiet" onClick={() => void downloadPng()}>
          <Download size={15} />
          {t('PNG letöltése')}
        </button>
        <button className="quiet" onClick={() => window.print()}>
          {t('Rajz nyomtatása / PDF')}
        </button>
      </div>
      {exportError && (
        <p role="alert" className="input-warning">
          {exportError}
        </p>
      )}
      <div ref={stage} className="single-line-stage" aria-label={t('Egyvonalas rajz munkaterülete')} tabIndex={0}>
        <div className="single-line-paper" style={{ width: drawing.width * zoom, height: drawing.height * zoom }}>
          <div
            className="single-line-svg"
            style={{ width: drawing.width, height: drawing.height, transform: `scale(${zoom})` }}
            onClick={(event) => selectFromSvg(event.target)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                if (event.target instanceof Element && event.target.closest('[data-device-id]')) {
                  event.preventDefault();
                  selectFromSvg(event.target);
                }
              }
            }}
            dangerouslySetInnerHTML={{ __html: drawing.svg.replace('role="img"', 'role="group"') }}
          />
        </div>
      </div>
      <div className="single-line-caption">
        <Network size={14} />
        <span>{t('Kattints egy készülékre az adatlap megnyitásához.')}</span>
      </div>
      {issues.length > 0 && (
        <section className="single-line-issues" aria-label={t('Kapcsolati jelzések')}>
          <h3>
            <AlertTriangle size={16} />
            {t('{count} kapcsolati jelzés', { count: issues.length })}
          </h3>
          <ul>
            {issues.map((issue, index) => (
              <li key={index}>
                {issue.deviceId && data.devices.some((device) => device.id === issue.deviceId) ? (
                  <button onClick={() => onSelect(issue.deviceId!)}>{issue.message}</button>
                ) : (
                  <span>{issue.message}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
