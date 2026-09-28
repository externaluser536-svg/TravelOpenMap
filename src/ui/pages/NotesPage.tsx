import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Empty } from '../common';
import { CATEGORIES, categoryById } from '../../core/categories';
import { formatDistance, haversine } from '../../core/geo';
import { fmtDate, useCover } from '../hooks';
import type { Note } from '../../data/db';
import { startNote } from '../../state/actions';

function NoteCard({ note, dist }: { note: Note; dist: number | null }) {
  const { t, lang } = useT();
  const units = usePrefs((s) => s.units);
  const cover = useCover(note);
  const cat = categoryById(note.category);
  const open = () => useApp.getState().patch({ selectedNoteId: note.id, sheet: { type: 'note', id: note.id } });
  return (
    <button className="note-card" onClick={open}>
      <span className="nc-cover" style={{ ['--c' as string]: cat.color }}>
        {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name={cat.icon} size={26} />}
        {note.videos > 0 && (
          <span className="nc-video">
            <Icon name="play" size={12} />
          </span>
        )}
      </span>
      <span className="nc-main">
        <b>{note.title}</b>
        <span className="nc-meta">
          <span className="chip" style={{ ['--c' as string]: cat.color }}>
            <Icon name={cat.icon} size={12} /> {t(`cat.${cat.id}`)}
          </span>
          <small>{fmtDate(note.createdAt, lang)}</small>
        </span>
        {note.text && <span className="nc-text">{note.text}</span>}
        <span className="nc-foot">
          {dist !== null && (
            <small>
              <Icon name="navigation" size={11} /> {formatDistance(dist, units, lang)}
            </small>
          )}
          {note.photos > 0 && (
            <small>
              <Icon name="camera" size={11} /> {note.photos}
            </small>
          )}
          {note.videos > 0 && (
            <small>
              <Icon name="video" size={11} /> {note.videos}
            </small>
          )}
        </span>
      </span>
    </button>
  );
}

export function NotesPage() {
  const { t, tn } = useT();
  const notes = useApp((s) => s.notes);
  const pos = useApp((s) => s.position);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [sort, setSort] = useState<'date' | 'dist'>('date');

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    let out = notes.filter((n) => (!cat || n.category === cat) && (!ql || n.title.toLowerCase().includes(ql) || n.text.toLowerCase().includes(ql)));
    const withDist = out.map((n) => ({ n, d: pos ? haversine(pos, n) : null }));
    if (sort === 'dist' && pos) withDist.sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
    out = withDist.map((x) => x.n);
    return withDist;
  }, [notes, q, cat, sort, pos]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('notes.title')}</h1>
          <p className="muted">
            {notes.length} {tn('unit.note', notes.length)}
          </p>
        </div>
        <button className="round-add" onClick={startNote} aria-label={t('note.add')}>
          <Icon name="plus" size={22} strokeWidth={2.6} />
        </button>
      </header>
      <div className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('notes.search')} />
        <button className={`sort-btn ${sort === 'dist' ? 'on' : ''}`} onClick={() => setSort(sort === 'date' ? 'dist' : 'date')} disabled={!pos && sort === 'date'}>
          <Icon name={sort === 'date' ? 'clock' : 'navigation'} size={16} />
        </button>
      </div>
      <div className="chips-scroll">
        <button className={`chip-btn ${cat === null ? 'on' : ''}`} onClick={() => setCat(null)}>
          {t('notes.all')}
        </button>
        {CATEGORIES.map((c) => (
          <button key={c.id} className={`chip-btn ${cat === c.id ? 'on' : ''}`} style={{ ['--c' as string]: c.color }} onClick={() => setCat(cat === c.id ? null : c.id)}>
            <Icon name={c.icon} size={14} /> {t(`cat.${c.id}`)}
          </button>
        ))}
      </div>
      <div className="page-scroll">
        {list.length === 0 ? (
          <Empty icon="pin" title={notes.length ? t('notes.none_found') : t('notes.empty_title')} text={notes.length ? undefined : t('notes.empty_text')} action={!notes.length && (
            <button className="btn primary" onClick={startNote}>
              <Icon name="plus" size={16} /> {t('note.add')}
            </button>
          )} />
        ) : (
          <div className="note-list">
            {list.map(({ n, d }) => (
              <NoteCard key={n.id} note={n} dist={d} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
