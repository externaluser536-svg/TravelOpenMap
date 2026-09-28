import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { engine } from '../../state/engine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { CompassRose, Sheet } from '../common';
import { categoryById } from '../../core/categories';
import { angleDiff, bearing as calcBearing, cardinal, formatCoords, formatDistance, haversine } from '../../core/geo';
import { blobUrl } from '../../services/media';
import { fmtDate, useNoteMedia } from '../hooks';
import { editNote } from '../../state/actions';

export function NoteSheet({ id }: { id: string }) {
  const { t, lang } = useT();
  const note = useApp((s) => s.notes.find((n) => n.id === id));
  const pos = useApp((s) => s.position);
  const heading = useApp((s) => s.heading);
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);
  const media = useNoteMedia(id, note?.updatedAt ?? 0);
  const [confirm, setConfirm] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  if (!note) return null;
  const cat = categoryById(note.category);
  const dist = pos ? haversine(pos, note) : null;
  const brg = pos ? calcBearing(pos, note) : null;
  const close = () => patch({ sheet: null });

  return (
    <Sheet
      tall
      onClose={close}
      title={
        <span className="note-title">
          <span className="chip solid" style={{ ['--c' as string]: cat.color }}>
            <Icon name={cat.icon} size={13} /> {t(`cat.${cat.id}`)}
          </span>
        </span>
      }
    >
      <div className="note-detail">
        <h1>{note.title}</h1>
        <small className="muted">{fmtDate(note.createdAt, lang, true)}</small>

        {media.length > 0 && (
          <div className="carousel">
            {media.map((m) =>
              m.kind === 'photo' ? (
                <button key={m.id} className="slide" onClick={() => setViewer(m.id)}>
                  <img src={blobUrl(m.blob)} alt="" />
                </button>
              ) : (
                <div key={m.id} className="slide">
                  <video src={blobUrl(m.blob)} poster={m.thumb ? blobUrl(m.thumb) : undefined} controls playsInline preload="metadata" />
                </div>
              ),
            )}
          </div>
        )}

        {note.text && <p className="note-text">{note.text}</p>}

        <div className="where card">
          <div className="where-arrow">
            <CompassRose size={44} angle={brg === null ? 0 : brg - (heading ?? 0)} ring />
          </div>
          <div className="where-main">
            <b>{dist === null ? t('note.no_gps') : formatDistance(dist, units, lang)}</b>
            <small>
              {brg === null ? formatCoords(note) : `${cardinal(brg, lang)} · ${Math.round(brg)}°`}
              {brg !== null && heading !== null && ` · ${Math.round(Math.abs(angleDiff(heading, brg)))}° ${angleDiff(heading, brg) > 0 ? t('note.right') : t('note.left')}`}
            </small>
          </div>
        </div>
        <small className="muted coords">{formatCoords(note)}</small>

        <div className="action-grid">
          <button className="btn ghost" onClick={() => patch({ sheet: null, screen: 'map', follow: false, flyTo: { lng: note.lng, lat: note.lat, zoom: 17, nonce: Date.now() } })}>
            <Icon name="map" size={16} /> {t('note.show')}
          </button>
          <button className="btn ghost" onClick={() => patch({ compassTarget: { lng: note.lng, lat: note.lat, name: note.title }, sheet: { type: 'compass' } })}>
            <Icon name="compass" size={16} /> {t('note.compass')}
          </button>
          <button
            className="btn ghost"
            onClick={() => patch({ sheet: null, screen: 'map', mode: 'measure', measurePoints: pos ? [{ lng: pos.lng, lat: pos.lat }, { lng: note.lng, lat: note.lat }] : [{ lng: note.lng, lat: note.lat }] })}
          >
            <Icon name="ruler" size={16} /> {t('note.measure')}
          </button>
          <button className="btn ghost" onClick={() => void editNote(note.id)}>
            <Icon name="pencil" size={16} /> {t('common.edit')}
          </button>
        </div>

        {confirm ? (
          <div className="confirm">
            <span>{t('note.delete_q')}</span>
            <button className="btn ghost" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn danger"
              onClick={() => {
                void engine.deleteNote(note.id);
                patch({ sheet: null, selectedNoteId: null });
              }}
            >
              {t('common.delete')}
            </button>
          </div>
        ) : (
          <button className="btn link danger-text" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={16} /> {t('common.delete')}
          </button>
        )}
      </div>

      {viewer && (
        <div className="lightbox" onClick={() => setViewer(null)}>
          <img src={blobUrl(media.find((m) => m.id === viewer)!.blob)} alt="" />
        </div>
      )}
    </Sheet>
  );
}
