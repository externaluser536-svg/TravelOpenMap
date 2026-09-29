// Резервная копия: один JSON-файл со всем прогрессом (туман, заметки, дни, треки, зоны).

import {
  getAllDays, getAllNotes, getAllTracks, getAllTrips, getAllWorkouts, clearTrips, loadFogChunks, putDay, putMedia, putNote, putTrack, putTrip, putWorkout, saveFogChunks, wipeAll, getMediaForNote,
  type MediaRecord, type Note, type TrackRecord, type Trip, type Workout,
} from './db';
import type { DayLog } from '../core/days';
import { usePrefs } from '../state/prefs';
import type { ExclusionZone } from '../core/fog';
import type { CompletedMap } from '../core/challenges';

interface BackupFile {
  app: 'TravelOpenMap';
  version: 1;
  createdAt: number;
  prefs: { zones: ExclusionZone[]; completed: CompletedMap; profile?: { nickname: string; avatarIcon: string; avatarColor: string; homeCountry: string; weightKg: number } };
  notes: Note[];
  media: (Omit<MediaRecord, 'blob' | 'thumb'> & { data?: string; thumbData?: string })[];
  fog: { key: number; cells: number[] }[];
  days: DayLog[];
  tracks: TrackRecord[];
  workouts?: Workout[];
  trips?: Trip[];
}

const toDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

const fromDataUrl = async (u: string): Promise<Blob> => (await fetch(u)).blob();

export async function exportBackup(includeMedia: boolean): Promise<Blob> {
  const notes = await getAllNotes();
  const media: BackupFile['media'] = [];
  if (includeMedia) {
    for (const n of notes) {
      for (const m of await getMediaForNote(n.id)) {
        const { blob, thumb, ...rest } = m;
        media.push({ ...rest, data: await toDataUrl(blob), thumbData: thumb ? await toDataUrl(thumb) : undefined });
      }
    }
  }
  const prefs = usePrefs.getState();
  const file: BackupFile = {
    app: 'TravelOpenMap',
    version: 1,
    createdAt: Date.now(),
    prefs: {
      zones: prefs.zones,
      completed: prefs.completed,
      profile: { nickname: prefs.nickname, avatarIcon: prefs.avatarIcon, avatarColor: prefs.avatarColor, homeCountry: prefs.homeCountry, weightKg: prefs.weightKg },
    },
    notes: includeMedia ? notes : notes.map((n) => ({ ...n, mediaIds: [] })),
    media,
    fog: (await loadFogChunks()).map((c) => ({ key: c.key, cells: Array.from(c.cells) })),
    days: await getAllDays(),
    tracks: await getAllTracks(),
    workouts: await getAllWorkouts(),
    trips: await getAllTrips(),
  };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

/** Заменяет ВСЕ текущие данные содержимым резервной копии. */
export async function importBackup(file: Blob): Promise<{ notes: number; cells: number }> {
  const data = JSON.parse(await file.text()) as BackupFile;
  if (data.app !== 'TravelOpenMap' || data.version !== 1) throw new Error('bad-backup');
  await wipeAll();
  await clearTrips();
  for (const n of data.notes) await putNote(n);
  for (const m of data.media) {
    const { data: d, thumbData, ...rest } = m;
    if (!d) continue;
    await putMedia({ ...rest, blob: await fromDataUrl(d), thumb: thumbData ? await fromDataUrl(thumbData) : undefined });
  }
  await saveFogChunks(data.fog.map((c) => ({ key: c.key, cells: Uint16Array.from(c.cells) })));
  for (const d of data.days) await putDay(d);
  for (const t of data.tracks) await putTrack(t);
  for (const w of data.workouts ?? []) await putWorkout(w);
  for (const t of data.trips ?? []) await putTrip(t);
  usePrefs.getState().set({ zones: data.prefs.zones ?? [], completed: data.prefs.completed ?? {}, ...(data.prefs.profile?.nickname ? data.prefs.profile : {}) });
  return { notes: data.notes.length, cells: data.fog.reduce((s, c) => s + c.cells.length, 0) };
}
