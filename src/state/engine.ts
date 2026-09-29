// Движок: превращает GPS-фиксы в открытую карту, статистику, XP и достижения.
// Единственное место, где живёт «истина» об исследованном мире.

import { FogGrid, cellArea, inAnyZone, keyY, type ExclusionZone } from '../core/fog';
import { haversine, type LngLat } from '../core/geo';
import { computeStreaks, dateKey, emptyDay, isActiveDay, lastDays, type DayLog } from '../core/days';
import {
  CHALLENGES,
  EMPTY_STATS,
  dailyQuests,
  evaluateChallenges,
  newlyCompleted,
  newlyCompletedDaily,
  type CompletedMap,
  type Stats,
} from '../core/challenges';
import { baseXp, levelFromXp } from '../core/levels';
import { hourHistogram } from '../core/stats';
import type { TrackPoint } from '../core/gpx';
import {
  deleteMedia,
  deleteNote as dbDeleteNote,
  getAllDays,
  getAllNotes,
  getAllTracks,
  loadFogChunks,
  putDay,
  putMedia,
  putNote,
  putTrack,
  saveFogChunks,
  uid,
  wipeAll,
  clearFogStore,
  type Note,
  type TrackRecord,
} from '../data/db';
import { usePrefs } from './prefs';
import { workoutEngine } from './workoutEngine';
import { loadTrips } from './trips';
import { useApp, type Fix, type NoteDraft } from './store';
import { success, tap } from '../services/haptics';
import { t } from '../i18n';

const MAX_SPEED = 70; // м/с — быстрее считаем «телепортом» (самолёт): путь не открываем
const JITTER = 3; // м — меньшие смещения считаем дрожанием GPS
const TRACK_STEP = 10; // м между точками трека
const SAVE_DELAY = 2500;

type RevealListener = (cells: number[]) => void;

class Engine {
  grid = new FogGrid();
  private days = new Map<string, DayLog>();
  private notes: Note[] = [];
  private tracks = new Map<string, TrackRecord>();
  private counted = { cells: 0, areaM2: 0 };
  private lastFix: Fix | null = null;
  private lastTrackPoint: TrackPoint | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyDays = new Set<string>();
  private dirtyTracks = new Set<string>();
  private revealListeners = new Set<RevealListener>();
  private prevLevel = 1;
  private publishQueued = false;
  /** true — не показывать уведомления и «левел-ап» (пакетные операции: демо, импорт). */
  quiet = false;

  // ------------------------------------------------------------------ init

  private initPromise: Promise<void> | null = null;

  /** Идемпотентно: повторные вызовы дожидаются той же загрузки. */
  init(): Promise<void> {
    return (this.initPromise ??= this.doInit());
  }

  private async doInit(): Promise<void> {
    const [chunks, days, notes, tracks] = await Promise.all([loadFogChunks(), getAllDays(), getAllNotes(), getAllTracks()]);
    for (const c of chunks) this.grid.loadChunk(c.key, c.cells);
    for (const d of days) this.days.set(d.date, d);
    this.notes = notes;
    for (const tr of tracks) this.tracks.set(tr.id, tr);
    this.recount();
    workoutEngine.onChange = () => this.publish();
    await Promise.all([workoutEngine.load(), loadTrips()]);
    // задним числом отмечаем уже выполненные челленджи без фанфар
    this.settleCompleted(false);
    this.prevLevel = levelFromXp(this.totalXp(this.computeStats())).level;
    this.publish();
    useApp.getState().patch({ ready: true });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => void this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush();
      });
    }
  }

  onReveal(cb: RevealListener): () => void {
    this.revealListeners.add(cb);
    return () => this.revealListeners.delete(cb);
  }

  // ------------------------------------------------------------------ позиция

  onFix(f: Fix): void {
    const app = useApp.getState();
    const prefs = usePrefs.getState();
    const p: LngLat = { lng: f.lng, lat: f.lat };
    const zones = prefs.zones;
    const weak = f.accuracy !== undefined && f.accuracy > prefs.minAccuracy;
    const inZone = inAnyZone(p, zones);
    const first = !app.position;
    app.patch({ position: f, gps: weak ? 'weak' : 'ok', inZone });
    if (first && app.follow) app.patch({ flyTo: { lng: f.lng, lat: f.lat, zoom: 16, nonce: Date.now() } });

    // Режим тренировки: фикс идёт только в трекер тренировки — туман не открывается, исследование не считается.
    if (workoutEngine.active) {
      workoutEngine.onFix(f);
      return;
    }

    if (weak) return;
    if (inZone) {
      // приватность: в исключённой зоне ничего не открываем, не считаем и не пишем в трек
      this.lastFix = null;
      this.lastTrackPoint = null;
      return;
    }

    const allowed = (c: LngLat) => !inAnyZone(c, zones);
    const prev = this.lastFix;
    let fresh: number[];
    let dist = 0;
    if (prev) {
      const d = haversine(prev, p);
      const dt = Math.max(1, (f.t - prev.t) / 1000);
      if (d < JITTER) {
        // стоим на месте — просто обновляем «якорь» времени
        this.lastFix = { ...prev, t: f.t };
        return;
      }
      if (d / dt > MAX_SPEED || d > 8000) {
        fresh = this.grid.reveal(p, prefs.revealRadius, allowed); // «телепорт»
      } else {
        dist = d;
        fresh = this.grid.revealSegment(prev, p, prefs.revealRadius, allowed);
      }
    } else {
      fresh = this.grid.reveal(p, prefs.revealRadius, allowed);
    }
    this.lastFix = f;

    const day = this.day(dateKey(f.t));
    day.distanceM += dist;
    if (fresh.length) {
      let area = 0;
      for (const k of fresh) area += cellArea(keyY(k));
      this.counted.cells += fresh.length;
      this.counted.areaM2 += area;
      day.cells += fresh.length;
      day.areaM2 += area;
      for (const cb of this.revealListeners) cb(fresh);
      if (fresh.length > 3) tap('light');
    }
    if (dist || fresh.length) this.dirtyDays.add(day.date);
    if (prefs.recordTrack) this.recordTrack(f);
    this.schedulePublish();
    this.scheduleSave();
  }

  private recordTrack(f: Fix): void {
    const last = this.lastTrackPoint;
    if (last && haversine(last, f) < TRACK_STEP && f.t - last.t < 60000) return;
    const date = dateKey(f.t);
    let rec = this.tracks.get(date);
    if (!rec) {
      rec = { id: date, date, points: [], updatedAt: f.t };
      this.tracks.set(date, rec);
    }
    const pt = { lng: f.lng, lat: f.lat, t: f.t };
    rec.points.push(pt);
    rec.updatedAt = f.t;
    this.lastTrackPoint = pt;
    this.dirtyTracks.add(date);
  }

  /** Линии пройденного пути (для режима «без тумана»). */
  trackLines(): [number, number][][] {
    const lines: [number, number][][] = [];
    for (const rec of this.tracks.values()) {
      let cur: [number, number][] = [];
      let prev: TrackPoint | null = null;
      for (const p of rec.points) {
        // разрыв в записи (более 5 мин или 500 м) — новая линия
        if (prev && (p.t - prev.t > 300000 || haversine(prev, p) > 500)) {
          if (cur.length > 1) lines.push(cur);
          cur = [];
        }
        cur.push([p.lng, p.lat]);
        prev = p;
      }
      if (cur.length > 1) lines.push(cur);
    }
    return lines;
  }

  allTracks(): TrackRecord[] {
    return [...this.tracks.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  private day(date: string): DayLog {
    let d = this.days.get(date);
    if (!d) {
      d = emptyDay(date);
      this.days.set(date, d);
    }
    return d;
  }

  // ------------------------------------------------------------------ заметки

  getNotes(): Note[] {
    return this.notes;
  }

  async saveNote(draft: NoteDraft): Promise<Note> {
    const now = Date.now();
    const existing = draft.id ? this.notes.find((n) => n.id === draft.id) : undefined;
    const id = existing?.id ?? uid();
    const keepIds = (existing?.mediaIds ?? []).filter((m) => !draft.removedMediaIds.includes(m));
    for (const mid of draft.removedMediaIds) await deleteMedia(mid);
    const newIds: string[] = [];
    let photos = 0;
    let videos = 0;
    for (const m of draft.media) {
      if (m.existingId) continue;
      const mid = uid();
      await putMedia({ id: mid, noteId: id, kind: m.kind, mime: m.mime, blob: m.blob, thumb: m.thumb, width: m.width, height: m.height, size: m.blob.size, createdAt: now });
      newIds.push(mid);
    }
    // счётчики: сохранённые + новые
    const keptMedia = draft.media.filter((m) => m.existingId && keepIds.includes(m.existingId));
    for (const m of [...keptMedia, ...draft.media.filter((m) => !m.existingId)]) {
      if (m.kind === 'photo') photos++;
      else videos++;
    }
    const note: Note = {
      id,
      title: draft.title.trim() || t('note.untitled'),
      text: draft.text.trim(),
      category: draft.category,
      lng: draft.lng,
      lat: draft.lat,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      mediaIds: [...keepIds, ...newIds],
      photos,
      videos,
    };
    await putNote(note);
    this.notes = [note, ...this.notes.filter((n) => n.id !== id)].sort((a, b) => b.createdAt - a.createdAt);
    this.afterNotesChanged();
    if (!existing) success();
    return note;
  }

  /** Быстрое добавление уже готовой заметки (используется демо-режимом и импортом). */
  async insertNote(note: Note): Promise<void> {
    await putNote(note);
    this.notes = [note, ...this.notes.filter((n) => n.id !== note.id)].sort((a, b) => b.createdAt - a.createdAt);
    this.afterNotesChanged();
  }

  async deleteNote(id: string): Promise<void> {
    await dbDeleteNote(id);
    this.notes = this.notes.filter((n) => n.id !== id);
    this.afterNotesChanged();
  }

  private afterNotesChanged(): void {
    this.publish();
  }

  // ------------------------------------------------------------------ зоны

  setZones(zones: ExclusionZone[]): void {
    usePrefs.getState().set({ zones });
    this.lastFix = null;
    this.lastTrackPoint = null;
    this.recount();
    this.grid.version++;
    this.publish();
  }

  private recount(): void {
    this.counted = this.grid.measure(usePrefs.getState().zones);
  }

  // ------------------------------------------------------------------ статистика

  private notesInScope(): Note[] {
    const zones = usePrefs.getState().zones;
    return zones.length ? this.notes.filter((n) => !inAnyZone(n, zones)) : this.notes;
  }

  /** Дни с числом заметок и расстоянием тренировок (для серий и графиков). */
  private mergedDays(): DayLog[] {
    const notesByDay = new Map<string, number>();
    for (const n of this.notesInScope()) {
      const k = dateKey(n.createdAt);
      notesByDay.set(k, (notesByDay.get(k) ?? 0) + 1);
    }
    const workoutByDay = new Map<string, number>();
    for (const w of workoutEngine.workouts) {
      const k = dateKey(w.startedAt);
      workoutByDay.set(k, (workoutByDay.get(k) ?? 0) + w.distanceM);
    }
    const merged = new Map<string, DayLog>();
    for (const d of this.days.values()) merged.set(d.date, { ...d, notes: notesByDay.get(d.date) ?? 0, workoutM: workoutByDay.get(d.date) ?? 0 });
    for (const [date, n] of notesByDay) if (!merged.has(date)) merged.set(date, { ...emptyDay(date), notes: n, workoutM: workoutByDay.get(date) ?? 0 });
    for (const [date, m] of workoutByDay) if (!merged.has(date)) merged.set(date, { ...emptyDay(date), workoutM: m });
    return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  computeStats(): Stats {
    const today = dateKey();
    const scoped = this.notesInScope();
    let early = 0;
    let night = 0;
    for (const n of scoped) {
      const h = new Date(n.createdAt).getHours();
      if (h >= 4 && h < 7) early++;
      if (h >= 22 || h < 4) night++;
    }
    const all = this.mergedDays();
    const { current, best } = computeStreaks(all, today);
    const td = all.find((d) => d.date === today) ?? emptyDay(today);
    const ws = workoutEngine.workouts;
    return {
      ...EMPTY_STATS,
      cells: this.counted.cells,
      areaM2: this.counted.areaM2,
      distanceM: this.days.size ? [...this.days.values()].reduce((s, d) => s + d.distanceM, 0) : 0,
      notes: scoped.length,
      photos: scoped.reduce((s, n) => s + n.photos, 0),
      videos: scoped.reduce((s, n) => s + n.videos, 0),
      categories: new Set(scoped.map((n) => n.category)).size,
      activeDays: all.filter((d) => isActiveDay(d)).length,
      streak: current,
      bestStreak: best,
      bestDayDistanceM: all.reduce((m, d) => Math.max(m, d.distanceM), 0),
      earlyNotes: early,
      nightNotes: night,
      workouts: ws.length,
      workoutDistanceM: ws.reduce((s, w) => s + w.distanceM, 0),
      longestRunM: ws.filter((w) => w.type === 'run').reduce((m, w) => Math.max(m, w.distanceM), 0),
      today: { cells: td.cells, areaM2: td.areaM2, distanceM: td.distanceM, notes: td.notes },
    };
  }

  private totalXp(stats: Stats): number {
    const completed = usePrefs.getState().completed;
    let xp = baseXp(stats);
    for (const c of CHALLENGES) if (completed[c.id] !== undefined) xp += c.xp;
    for (const id of Object.keys(completed)) {
      if (!id.startsWith('daily:')) continue;
      const [, date, n] = id.split(':');
      xp += dailyQuests(date, EMPTY_STATS.today, {})[Number(n)]?.xp ?? 0;
    }
    return xp;
  }

  /** Отмечает выполненные челленджи. loud = показывать уведомления. */
  private settleCompleted(loud: boolean): boolean {
    const prefs = usePrefs.getState();
    const stats = this.computeStats();
    const completed: CompletedMap = { ...prefs.completed };
    let changed = false;
    const now = Date.now();
    for (const d of newlyCompleted(stats, completed)) {
      completed[d.id] = now;
      changed = true;
      if (loud) {
        success();
        useApp.getState().toast({ kind: 'quest', title: t(`ch.${d.id}`), text: t('quest.completed'), icon: d.icon, xp: d.xp });
      }
    }
    const daily = dailyQuests(dateKey(), stats.today, completed);
    for (const q of newlyCompletedDaily(daily, completed)) {
      completed[q.id] = now;
      changed = true;
      if (loud) {
        success();
        useApp.getState().toast({ kind: 'daily', title: t(`daily.${q.kind}`, { n: fmtTarget(q) }), text: t('daily.completed'), icon: q.icon, xp: q.xp });
      }
    }
    if (changed) prefs.set({ completed });
    return changed;
  }

  private schedulePublish(): void {
    if (this.publishQueued) return;
    this.publishQueued = true;
    setTimeout(() => {
      this.publishQueued = false;
      this.publish();
    }, 400);
  }

  publish(): void {
    this.settleCompleted(!this.quiet && useApp.getState().ready);
    const stats = this.computeStats();
    const level = levelFromXp(this.totalXp(stats));
    const prefs = usePrefs.getState();
    const today = dateKey();
    const merged = this.mergedDays();
    const app = useApp.getState();
    const levelUp = !this.quiet && useApp.getState().ready && level.level > this.prevLevel ? level : null;
    this.prevLevel = Math.max(this.prevLevel, level.level);
    app.patch({
      notes: this.notes,
      stats,
      level,
      challenges: evaluateChallenges(stats, prefs.completed),
      quests: dailyQuests(today, stats.today, prefs.completed),
      allDays: merged,
      hours: hourHistogram(this.allTracks()),
      lastDays: lastDays(merged, today, 14).map((d) => ({ date: d.date, distanceM: d.distanceM, areaM2: d.areaM2, notes: d.notes })),
      ...(levelUp ? { levelUp } : {}),
    });
    if (levelUp) success();
  }

  // ------------------------------------------------------------------ сохранение

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, SAVE_DELAY);
  }

  async flush(): Promise<void> {
    const chunks = this.grid.takeDirty();
    const days = [...this.dirtyDays].map((d) => this.days.get(d)!).filter(Boolean);
    const tracks = [...this.dirtyTracks].map((d) => this.tracks.get(d)!).filter(Boolean);
    this.dirtyDays.clear();
    this.dirtyTracks.clear();
    try {
      await saveFogChunks(chunks);
      for (const d of days) await putDay(d);
      for (const tr of tracks) await putTrack(tr);
    } catch (e) {
      console.error('Не удалось сохранить прогресс', e);
    }
  }

  // ------------------------------------------------------------------ полный сброс / импорт

  async resetAll(): Promise<void> {
    await wipeAll();
    await clearFogStore();
    workoutEngine.discard();
    await workoutEngine.reload();
    this.grid.clear();
    this.days.clear();
    this.tracks.clear();
    this.notes = [];
    this.lastFix = null;
    this.lastTrackPoint = null;
    this.counted = { cells: 0, areaM2: 0 };
    usePrefs.getState().set({ completed: {} });
    this.prevLevel = 1;
    this.publish();
  }

  /** Полная перезагрузка состояния из БД (после импорта резервной копии). */
  async reloadFromDb(): Promise<void> {
    this.grid.clear();
    this.days.clear();
    this.tracks.clear();
    const [chunks, days, notes, tracks] = await Promise.all([loadFogChunks(), getAllDays(), getAllNotes(), getAllTracks()]);
    for (const c of chunks) this.grid.loadChunk(c.key, c.cells);
    for (const d of days) this.days.set(d.date, d);
    for (const tr of tracks) this.tracks.set(tr.id, tr);
    this.notes = notes;
    await Promise.all([workoutEngine.reload(), loadTrips()]);
    this.recount();
    this.settleCompleted(false);
    this.prevLevel = levelFromXp(this.totalXp(this.computeStats())).level;
    this.publish();
  }

  /** Для демо/тестов: сбросить «якорь» последней позиции. */
  resetAnchor(): void {
    this.lastFix = null;
    this.lastTrackPoint = null;
  }
}

function fmtTarget(q: { unit: string; target: number }): string {
  if (q.unit === 'km') return `${+(q.target / 1000).toFixed(1)} ${t('unit.km')}`;
  if (q.unit === 'km2') return `${+(q.target / 1e6).toFixed(2)} ${t('unit.km2')}`;
  return String(q.target);
}

export const engine = new Engine();
