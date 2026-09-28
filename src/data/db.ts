// Локальное хранилище на IndexedDB. Всё лежит на устройстве, ничего не уходит в сеть.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DayLog } from '../core/days';
import type { TrackPoint } from '../core/gpx';

export interface Note {
  id: string;
  title: string;
  text: string;
  category: string;
  lng: number;
  lat: number;
  createdAt: number;
  updatedAt: number;
  mediaIds: string[];
  photos: number;
  videos: number;
}

export interface MediaRecord {
  id: string;
  noteId: string;
  kind: 'photo' | 'video';
  mime: string;
  blob: Blob;
  thumb?: Blob;
  width?: number;
  height?: number;
  size: number;
  createdAt: number;
}

export interface TrackRecord {
  id: string; // = дата YYYY-MM-DD
  date: string;
  points: TrackPoint[];
  updatedAt: number;
}

export interface OfflineMapRecord {
  id: string;
  name: string;
  blob: Blob;
  size: number;
  bounds?: [number, number, number, number]; // west, south, east, north
  minzoom?: number;
  maxzoom?: number;
  addedAt: number;
}

interface TomDB extends DBSchema {
  notes: { key: string; value: Note; indexes: { createdAt: number } };
  media: { key: string; value: MediaRecord; indexes: { noteId: string } };
  fog: { key: number; value: { key: number; cells: Uint16Array } };
  days: { key: string; value: DayLog };
  tracks: { key: string; value: TrackRecord };
  maps: { key: string; value: OfflineMapRecord };
}

export type Db = IDBPDatabase<TomDB>;

let dbPromise: Promise<Db> | null = null;

export function getDb(name = 'travelopenmap'): Promise<Db> {
  if (!dbPromise) {
    dbPromise = openDB<TomDB>(name, 1, {
      upgrade(db) {
        const notes = db.createObjectStore('notes', { keyPath: 'id' });
        notes.createIndex('createdAt', 'createdAt');
        const media = db.createObjectStore('media', { keyPath: 'id' });
        media.createIndex('noteId', 'noteId');
        db.createObjectStore('fog', { keyPath: 'key' });
        db.createObjectStore('days', { keyPath: 'date' });
        db.createObjectStore('tracks', { keyPath: 'id' });
        db.createObjectStore('maps', { keyPath: 'id' });
      },
    });
  }
  return dbPromise;
}

/** Только для тестов: сбросить кэш соединения. */
export function _resetDbForTests(): void {
  dbPromise = null;
}

// ---------- Заметки и медиа ----------

export async function getAllNotes(): Promise<Note[]> {
  return (await (await getDb()).getAllFromIndex('notes', 'createdAt')).reverse();
}

export async function putNote(n: Note): Promise<void> {
  await (await getDb()).put('notes', n);
}

export async function deleteNote(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['notes', 'media'], 'readwrite');
  const media = await tx.objectStore('media').index('noteId').getAllKeys(id);
  for (const k of media) await tx.objectStore('media').delete(k);
  await tx.objectStore('notes').delete(id);
  await tx.done;
}

export async function putMedia(m: MediaRecord): Promise<void> {
  await (await getDb()).put('media', m);
}

export async function getMedia(id: string): Promise<MediaRecord | undefined> {
  return (await getDb()).get('media', id);
}

export async function getMediaForNote(noteId: string): Promise<MediaRecord[]> {
  return (await getDb()).getAllFromIndex('media', 'noteId', noteId);
}

export async function deleteMedia(id: string): Promise<void> {
  await (await getDb()).delete('media', id);
}

// ---------- Туман ----------

export async function loadFogChunks(): Promise<{ key: number; cells: Uint16Array }[]> {
  return (await getDb()).getAll('fog');
}

export async function saveFogChunks(chunks: { key: number; cells: Uint16Array }[]): Promise<void> {
  if (!chunks.length) return;
  const db = await getDb();
  const tx = db.transaction('fog', 'readwrite');
  for (const c of chunks) tx.store.put(c);
  await tx.done;
}

export async function clearFogStore(): Promise<void> {
  await (await getDb()).clear('fog');
}

// ---------- Дни и треки ----------

export async function getAllDays(): Promise<DayLog[]> {
  return (await getDb()).getAll('days');
}

export async function putDay(d: DayLog): Promise<void> {
  await (await getDb()).put('days', d);
}

export async function getAllTracks(): Promise<TrackRecord[]> {
  return (await getDb()).getAll('tracks');
}

export async function putTrack(t: TrackRecord): Promise<void> {
  await (await getDb()).put('tracks', t);
}

// ---------- Офлайн-карты ----------

export async function listMaps(): Promise<OfflineMapRecord[]> {
  return (await getDb()).getAll('maps');
}

export async function putMap(m: OfflineMapRecord): Promise<void> {
  await (await getDb()).put('maps', m);
}

export async function deleteMapRecord(id: string): Promise<void> {
  await (await getDb()).delete('maps', id);
}

// ---------- Общее ----------

export async function wipeAll(): Promise<void> {
  const db = await getDb();
  const names = ['notes', 'media', 'fog', 'days', 'tracks'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  await tx.done;
}

export const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
