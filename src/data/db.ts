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
  /** ISO-код страны, если карта скачана через каталог стран */
  country?: string;
  addedAt: number;
}

// ---------- Тренировки ----------

export type WorkoutType = 'walk' | 'run';

export interface WorkoutSplit {
  /** номер километра (1, 2, …) */
  km: number;
  timeS: number;
  /** темп на этом километре, с/км */
  paceS: number;
}

export interface Workout {
  id: string;
  type: WorkoutType;
  startedAt: number;
  endedAt: number;
  /** чистое время (без пауз), с */
  elapsedS: number;
  /** время в движении, с */
  movingS: number;
  distanceM: number;
  avgSpeed: number; // м/с (по времени в движении)
  maxSpeed: number;
  avgPaceS: number; // с/км
  bestPaceS: number | null;
  calories: number;
  weightKg: number;
  elevGainM: number | null;
  /** площадь полосы вдоль маршрута (ширина ≈ 50 м), м² */
  corridorM2: number;
  /** площадь, ограниченная маршрутом: петля (loop) или выпуклая оболочка (hull) */
  enclosedM2: number;
  enclosedKind: 'loop' | 'hull' | null;
  splits: WorkoutSplit[];
  /** [lng, lat, t, alt|null] — прореженные точки трека */
  points: [number, number, number, number | null][];
}

// ---------- Планирование поездок ----------

export type TripStatus = 'idea' | 'planned' | 'booked' | 'done' | 'cancelled';
export type TripTransport = 'plane' | 'train' | 'car' | 'bus' | 'ship' | 'bike' | 'other';
export type ExpenseCategory = 'transport' | 'stay' | 'food' | 'fun' | 'shopping' | 'other';

export interface TripItem {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM (необязательно) */
  time?: string;
  title: string;
  place?: string;
  note?: string;
  done?: boolean;
}

export interface TripExpense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  paid?: boolean;
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
  group: string;
}

export interface Trip {
  id: string;
  title: string;
  /** ISO 3166-1 alpha-2 или '' */
  country: string;
  destination: string;
  /** YYYY-MM-DD; пусто — даты ещё не выбраны */
  startDate: string;
  endDate: string;
  status: TripStatus;
  transport: TripTransport;
  travelers: number;
  budget: number;
  currency: string;
  notes: string;
  items: TripItem[];
  expenses: TripExpense[];
  checklist: ChecklistItem[];
  createdAt: number;
  updatedAt: number;
}

interface TomDB extends DBSchema {
  workouts: { key: string; value: Workout; indexes: { startedAt: number } };
  trips: { key: string; value: Trip; indexes: { startDate: string } };
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
    dbPromise = openDB<TomDB>(name, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('createdAt', 'createdAt');
          const media = db.createObjectStore('media', { keyPath: 'id' });
          media.createIndex('noteId', 'noteId');
          db.createObjectStore('fog', { keyPath: 'key' });
          db.createObjectStore('days', { keyPath: 'date' });
          db.createObjectStore('tracks', { keyPath: 'id' });
          db.createObjectStore('maps', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('workouts', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
          db.createObjectStore('trips', { keyPath: 'id' }).createIndex('startDate', 'startDate');
        }
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
  for (const c of chunks) {
    if (c.cells.length) tx.store.put(c);
    else tx.store.delete(c.key);
  }
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

// ---------- Тренировки и поездки ----------

export async function getAllWorkouts(): Promise<Workout[]> {
  return (await (await getDb()).getAllFromIndex('workouts', 'startedAt')).reverse();
}
export async function putWorkout(w: Workout): Promise<void> {
  await (await getDb()).put('workouts', w);
}
export async function deleteWorkout(id: string): Promise<void> {
  await (await getDb()).delete('workouts', id);
}
export async function getAllTrips(): Promise<Trip[]> {
  return (await getDb()).getAll('trips');
}
export async function putTrip(t: Trip): Promise<void> {
  await (await getDb()).put('trips', t);
}
export async function clearTrips(): Promise<void> {
  await (await getDb()).clear('trips');
}
export async function deleteTrip(id: string): Promise<void> {
  await (await getDb()).delete('trips', id);
}

// ---------- Общее ----------

export async function wipeAll(): Promise<void> {
  const db = await getDb();
  const names = ['notes', 'media', 'fog', 'days', 'tracks', 'workouts'] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  await tx.done;
}

export const uid = (): string =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
