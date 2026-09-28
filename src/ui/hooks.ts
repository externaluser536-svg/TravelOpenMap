import { useEffect, useState } from 'react';
import { getMedia, getMediaForNote, type MediaRecord, type Note } from '../data/db';
import { blobUrl } from '../services/media';

const coverCache = new Map<string, string | null>();

/** Миниатюра первой картинки заметки (или null). */
export function useCover(note: Note): string | null {
  const first = note.mediaIds[0];
  const [url, setUrl] = useState<string | null>(first ? (coverCache.get(first) ?? null) : null);
  useEffect(() => {
    let alive = true;
    if (!first) {
      setUrl(null);
      return;
    }
    if (coverCache.has(first)) {
      setUrl(coverCache.get(first) ?? null);
      return;
    }
    void getMedia(first).then((m) => {
      const u = m ? blobUrl(m.thumb ?? m.blob) : null;
      coverCache.set(first, u);
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [first]);
  return url;
}

export function useNoteMedia(noteId: string, version: number): MediaRecord[] {
  const [recs, setRecs] = useState<MediaRecord[]>([]);
  useEffect(() => {
    let alive = true;
    void getMediaForNote(noteId).then((r) => alive && setRecs(r.sort((a, b) => a.createdAt - b.createdAt)));
    return () => {
      alive = false;
    };
  }, [noteId, version]);
  return recs;
}

export function fmtDate(ts: number, lang: string, withTime = false): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' };
  return d.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB', opts);
}
