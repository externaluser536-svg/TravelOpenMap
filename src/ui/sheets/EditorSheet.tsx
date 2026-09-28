import { useRef, useState } from 'react';
import { useApp, type DraftMedia } from '../../state/store';
import { engine } from '../../state/engine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { CATEGORIES } from '../../core/categories';
import { formatCoords } from '../../core/geo';
import { processFile, blobUrl } from '../../services/media';

export function EditorSheet() {
  const { t } = useT();
  const draft = useApp((s) => s.draft);
  const position = useApp((s) => s.position);
  const patch = useApp((s) => s.patch);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  if (!draft) return null;

  const close = () => patch({ sheet: null, draft: null });
  const set = (p: Partial<typeof draft>) => patch({ draft: { ...draft, ...p } });

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const added: DraftMedia[] = [];
    for (const f of Array.from(files)) {
      try {
        added.push(await processFile(f));
      } catch {
        useApp.getState().toast({ kind: 'error', title: t('media.failed'), text: f.name });
      }
    }
    const cur = useApp.getState().draft;
    if (cur) patch({ draft: { ...cur, media: [...cur.media, ...added] } });
    setBusy(false);
  };

  const removeMedia = (m: DraftMedia) =>
    set({ media: draft.media.filter((x) => x.key !== m.key), removedMediaIds: m.existingId ? [...draft.removedMediaIds, m.existingId] : draft.removedMediaIds });

  const save = async () => {
    setSaving(true);
    try {
      const n = await engine.saveNote(draft);
      patch({ sheet: null, draft: null, mode: 'normal' });
      useApp.getState().toast({ kind: 'info', title: draft.id ? t('note.updated') : t('note.saved'), text: n.title, icon: 'check' });
    } catch (e) {
      console.error(e);
      useApp.getState().toast({ kind: 'error', title: t('note.save_failed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      tall
      title={draft.id ? t('note.edit') : t('note.new')}
      onClose={close}
      footer={
        <button className="btn primary block" disabled={saving || busy} onClick={save}>
          <Icon name="check" size={18} /> {t('common.save')}
        </button>
      }
    >
      <div className="form">
        <label className="field">
          <span>{t('note.title')}</span>
          <input className="input" value={draft.title} maxLength={80} placeholder={t('note.title_ph')} onChange={(e) => set({ title: e.target.value })} />
        </label>

        <div className="field">
          <span>{t('note.category')}</span>
          <div className="cat-grid">
            {CATEGORIES.map((c) => (
              <button key={c.id} className={`cat ${draft.category === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => set({ category: c.id })}>
                <Icon name={c.icon} size={18} />
                <small>{t(`cat.${c.id}`)}</small>
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>{t('note.text')}</span>
          <textarea className="input" rows={4} value={draft.text} placeholder={t('note.text_ph')} onChange={(e) => set({ text: e.target.value })} />
        </label>

        <div className="field">
          <span>{t('note.media')}</span>
          <div className="media-strip">
            {draft.media.map((m) => (
              <div key={m.key} className="mthumb">
                <img src={blobUrl(m.thumb ?? m.blob)} alt="" />
                {m.kind === 'video' && (
                  <span className="mt-play">
                    <Icon name="play" size={14} />
                  </span>
                )}
                <button className="mt-x" onClick={() => removeMedia(m)} aria-label="remove">
                  <Icon name="x" size={12} strokeWidth={3} />
                </button>
              </div>
            ))}
            {busy && <div className="mthumb loading" />}
            <button className="madd" onClick={() => photoRef.current?.click()}>
              <Icon name="camera" size={22} />
              <small>{t('media.photo')}</small>
            </button>
            <button className="madd" onClick={() => videoRef.current?.click()}>
              <Icon name="video" size={22} />
              <small>{t('media.video')}</small>
            </button>
            <button className="madd" onClick={() => galleryRef.current?.click()}>
              <Icon name="images" size={22} />
              <small>{t('media.gallery')}</small>
            </button>
          </div>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={videoRef} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        </div>

        <div className="field">
          <span>{t('note.location')}</span>
          <div className="loc-card">
            <Icon name="pin" size={18} />
            <div>
              <b>{formatCoords(draft)}</b>
              <small>{draft.manual ? t('note.loc_manual') : position ? t('note.loc_gps') : t('note.loc_center')}</small>
            </div>
          </div>
          <div className="loc-actions">
            <button className="btn ghost" onClick={() => patch({ mode: 'pick', sheet: null, follow: false, flyTo: { lng: draft.lng, lat: draft.lat, zoom: 16.5, nonce: Date.now() } })}>
              <Icon name="crosshair" size={16} /> {t('note.pick_on_map')}
            </button>
            {position && (
              <button className="btn ghost" onClick={() => set({ lng: position.lng, lat: position.lat, manual: false })}>
                <Icon name="locate" size={16} /> {t('note.use_gps')}
              </button>
            )}
          </div>
        </div>
      </div>
    </Sheet>
  );
}
