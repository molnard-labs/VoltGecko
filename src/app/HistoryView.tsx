import { useState } from 'react';
import { History, Plus } from 'lucide-react';
import { t } from '../i18n';
import type { ProjectDocument } from '../types';
import { formatDate } from './format';
import './history-view.css';

interface Props {
  document: ProjectDocument;
  onSave: (note: string) => void;
  onRestore: (id: string) => void;
}

export function HistoryView({ document, onSave, onRestore }: Props) {
  const [note, setNote] = useState('');
  return (
    <div className="history-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{t('A MUNKA TÖRTÉNETE')}</span>
          <h2>{t('Előzmények')}</h2>
          <p>{t('Mentett állapotok, amelyekhez később is visszatérhetsz.')}</p>
        </div>
        <span className="history-count">{t('{count} mentett változat', {count: document.revisions.length})}</span>
      </div>
      <div className="revision-compose">
        <input
          aria-label={t('Verzió megjegyzése')}
          placeholder={t('Mi változott? Pl. konyhai dugaljak pontosítva')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          className="primary"
          onClick={() => {
            onSave(note.trim() || t('Mentett változat'));
            setNote('');
          }}
        >
          <Plus size={16} />
          {t('Verzió mentése')}
        </button>
      </div>
      <div className="timeline">
        {[...document.revisions].reverse().map((revision, index) => (
          <article key={revision.id}>
            <span className={`timeline-dot ${index === 0 ? 'current' : ''}`} />
            <div>
              <span className="eyebrow">
                {formatDate(revision.createdAt)}
                {revision.id === document.headRevisionId ? t(' · AKTUÁLIS ELŐZMÉNY') : ''}
              </span>
              <h3>{revision.note || t('Mentett változat')}</h3>
              <p>
                {t('{devices} eszköz · {circuits} áramkör · {sheets} tervlap', {
                  devices: revision.data.devices.length,
                  circuits: revision.data.circuits.length,
                  sheets: revision.data.sheets.length
                })}
                {revision.restoredFrom ? t(' · Visszaállításból') : ''}
              </p>
            </div>
            <button
              className="quiet"
              onClick={() => {
                if (confirm(t('Visszaállítod ezt az állapotot? A jelenlegi munkáról is készül egy mentett változat.')))
                  onRestore(revision.id);
              }}
            >
              <History size={15} />
              {t('Visszaállítás')}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}
