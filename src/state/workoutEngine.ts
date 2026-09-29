// Движок тренировки: связывает трекер (core/workout) с GPS, хранилищем и интерфейсом.
// В режиме тренировки туман войны не используется и исследование карты не засчитывается.

import { WorkoutTracker, type WorkoutFix } from '../core/workout';
import { deleteWorkout, getAllWorkouts, putWorkout, uid, type Workout, type WorkoutType } from '../data/db';
import { usePrefs } from './prefs';
import { useApp, type Fix } from './store';
import { startLocation } from '../services/location';
import { success, tap } from '../services/haptics';
import { t } from '../i18n';

const KEY = 'tom.workout.active';
const MIN_DISTANCE = 30; // м — короче не сохраняем

type WakeLockSentinelLike = { release: () => Promise<void> };

class WorkoutEngine {
  private tracker: WorkoutTracker | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private wake: WakeLockSentinelLike | null = null;
  private lastSave = 0;
  private lastPub = 0;
  workouts: Workout[] = [];
  /** вызывается при любом изменении списка тренировок (пересчёт статистики/XP) */
  onChange: () => void = () => {};

  get active(): boolean {
    return this.tracker !== null;
  }

  async load(): Promise<void> {
    this.workouts = await getAllWorkouts();
    useApp.getState().patch({ workouts: this.workouts });
    // незавершённая тренировка после закрытия приложения — восстанавливаем на паузе
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        this.tracker = WorkoutTracker.restore(raw);
        this.tracker.pause(Date.now());
        this.startTimer();
        this.publish();
      }
    } catch {
      localStorage.removeItem(KEY);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.persist(true));
    }
  }

  start(type: WorkoutType, at = Date.now()): void {
    if (this.tracker) return;
    this.tracker = new WorkoutTracker(type, usePrefs.getState().weightKg, at);
    tap('heavy');
    void startLocation();
    const pos = useApp.getState().position;
    if (pos) this.onFix(pos);
    this.startTimer();
    void this.acquireWake();
    this.persist(true);
    this.publish();
  }

  pause(): void {
    this.tracker?.pause(Date.now());
    tap('medium');
    this.persist(true);
    this.publish();
  }

  resume(): void {
    this.tracker?.resume(Date.now());
    tap('medium');
    this.persist(true);
    this.publish();
  }

  /** Завершает тренировку. Слишком короткая (< 30 м) не сохраняется. */
  async finish(now = Date.now()): Promise<Workout | null> {
    const tr = this.tracker;
    if (!tr) return null;
    const w = tr.finish(now, uid());
    this.clear();
    if (w.distanceM < MIN_DISTANCE) {
      useApp.getState().toast({ kind: 'info', title: t('workout.too_short'), icon: 'info' });
      return null;
    }
    await putWorkout(w);
    this.workouts = [w, ...this.workouts.filter((x) => x.id !== w.id)].sort((a, b) => b.startedAt - a.startedAt);
    useApp.getState().patch({ workouts: this.workouts });
    success();
    this.onChange();
    return w;
  }

  discard(): void {
    this.clear();
    tap('medium');
  }

  async remove(id: string): Promise<void> {
    await deleteWorkout(id);
    this.workouts = this.workouts.filter((w) => w.id !== id);
    useApp.getState().patch({ workouts: this.workouts });
    this.onChange();
  }

  /** Сохраняет готовую тренировку (демо-данные, импорт). */
  async insert(w: Workout): Promise<void> {
    await putWorkout(w);
    this.workouts = [w, ...this.workouts.filter((x) => x.id !== w.id)].sort((a, b) => b.startedAt - a.startedAt);
    useApp.getState().patch({ workouts: this.workouts });
    this.onChange();
  }

  async reload(): Promise<void> {
    this.workouts = await getAllWorkouts();
    useApp.getState().patch({ workouts: this.workouts });
  }

  /** Создаёт трекер с заданным временем начала — для воспроизведения записанных треков. */
  startAt(type: WorkoutType, at: number): WorkoutTracker {
    this.tracker = new WorkoutTracker(type, usePrefs.getState().weightKg, at);
    return this.tracker;
  }

  onFix(f: Fix | WorkoutFix): void {
    const tr = this.tracker;
    if (!tr) return;
    const alt = (f as Fix & { alt?: number | null }).alt;
    tr.addFix({ lng: f.lng, lat: f.lat, t: f.t, accuracy: f.accuracy, alt: alt ?? null });
    if (Date.now() - this.lastSave > 10000) this.persist(false);
    if (Date.now() - this.lastPub > 500) this.publish(); // не ждём секундного таймера — метрики обновляются вместе с GPS
  }

  private clear(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.tracker = null;
    localStorage.removeItem(KEY);
    void this.wake?.release().catch(() => {});
    this.wake = null;
    useApp.getState().patch({ workoutLive: null, workoutRoute: [] });
  }

  private startTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.publish(), 1000);
  }

  publish(): void {
    const tr = this.tracker;
    if (!tr) return;
    this.lastPub = Date.now();
    const live = tr.live(Date.now());
    const app = useApp.getState();
    const routeChanged = live.points !== app.workoutRoute.length;
    app.patch({ workoutLive: { ...live, type: tr.type }, ...(routeChanged ? { workoutRoute: tr.route() } : {}) });
  }

  private persist(force: boolean): void {
    if (!this.tracker) return;
    if (!force && Date.now() - this.lastSave < 5000) return;
    this.lastSave = Date.now();
    try {
      localStorage.setItem(KEY, this.tracker.serialize());
    } catch {
      /* хранилище переполнено — не критично */
    }
  }

  private async acquireWake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } };
      this.wake = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      /* не поддерживается — экран может гаснуть */
    }
  }
}

export const workoutEngine = new WorkoutEngine();
