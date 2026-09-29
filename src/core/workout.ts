// Режим тренировки (ходьба / бег): чистая логика без браузера, покрыта тестами.
//
// Трекер принимает GPS-фиксы и считает: дистанцию, время (общее и в движении), темп (средний,
// текущий, по километрам), скорость, калории (по MET), набор высоты, площадь полосы охвата вдоль
// маршрута и площадь, ограниченную маршрутом (петля или выпуклая оболочка).
// Туман войны в этом режиме не используется: полоса охвата считается отдельной сеткой.

import { FogGrid, cellArea, keyY } from './fog';
import { haversine, type LngLat } from './geo';
import type { Workout, WorkoutSplit, WorkoutType } from '../data/db';

export interface WorkoutFix extends LngLat {
  t: number;
  accuracy?: number;
  alt?: number | null;
  altAccuracy?: number | null;
}

export interface LiveStats {
  state: 'running' | 'paused' | 'finished';
  elapsedS: number;
  movingS: number;
  distanceM: number;
  /** средний темп по времени в движении, с/км (null, пока нет дистанции) */
  avgPaceS: number | null;
  /** темп за последние ~30 с, с/км */
  currentPaceS: number | null;
  speed: number; // м/с, за последние ~10 с
  calories: number;
  corridorM2: number;
  elevGainM: number | null;
  splits: WorkoutSplit[];
  points: number;
}

const MAX_ACCURACY = 35; // м — хуже игнорируем
const MIN_STEP = 2; // м — меньше считаем дрожанием
const MAX_SPEED: Record<WorkoutType, number> = { walk: 7, run: 12.5 }; // м/с — быстрее считаем сбоем GPS
const MAX_GAP_S = 20; // с — при большем разрыве время не считается «в движении»
const CORRIDOR_RADIUS = 25; // м → полоса шириной ≈ 50 м
const KEEP_EVERY_M = 5;
const KEEP_EVERY_S = 10;
const WINDOW_S = 30;

/** MET (метаболический эквивалент) по скорости, км/ч. Значения — по Compendium of Physical Activities. */
const MET_TABLE: Record<WorkoutType, [number, number][]> = {
  walk: [[2, 2.0], [3, 2.3], [4, 2.9], [5, 3.5], [6, 4.8], [7, 6.5], [8, 8.3]],
  run: [[6, 6.0], [8, 8.3], [9, 9.0], [10, 9.8], [11, 10.5], [12, 11.5], [14, 13.5], [16, 15.5], [20, 19]],
};

export function metFor(type: WorkoutType, kmh: number): number {
  const t = MET_TABLE[type];
  if (kmh <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) {
    if (kmh <= t[i][0]) {
      const [x0, y0] = t[i - 1];
      const [x1, y1] = t[i];
      return y0 + ((kmh - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return t[t.length - 1][1];
}

/** Площадь многоугольника (м²) по формуле шнурования в локальной проекции. */
export function polygonAreaM2(pts: LngLat[]): number {
  if (pts.length < 3) return 0;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.lng * kx * (b.lat * ky) - b.lng * kx * (a.lat * ky);
  }
  return Math.abs(s) / 2;
}

/** Выпуклая оболочка (алгоритм Эндрю). */
export function convexHull(pts: LngLat[]): LngLat[] {
  const p = [...pts].sort((a, b) => a.lng - b.lng || a.lat - b.lat);
  if (p.length < 3) return p;
  const cross = (o: LngLat, a: LngLat, b: LngLat) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
  const lower: LngLat[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: LngLat[] = [];
  for (const q of [...p].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface Snapshot {
  type: WorkoutType;
  weightKg: number;
  startedAt: number;
  pauses: [number, number | null][];
  points: [number, number, number, number | null][];
  distanceM: number;
  movingMs: number;
  calories: number;
  splits: WorkoutSplit[];
  maxSpeed: number;
  elevGain: number | null;
  refAlt: number | null;
  corridorM2: number;
  last: WorkoutFix | null;
  splitClock: { d: number; t: number }[];
}

export class WorkoutTracker {
  readonly type: WorkoutType;
  readonly weightKg: number;
  readonly startedAt: number;
  private pauses: [number, number | null][] = [];
  private points: [number, number, number, number | null][] = [];
  private distanceM = 0;
  private movingMs = 0;
  private calories = 0;
  private splits: WorkoutSplit[] = [];
  private maxSpeed = 0;
  private elevGain: number | null = null;
  private refAlt: number | null = null;
  private grid = new FogGrid();
  private corridorM2 = 0;
  private last: WorkoutFix | null = null;
  /** (накопленная дистанция, время) на каждой принятой точке — для интерполяции сплитов и текущего темпа */
  private clock: { d: number; t: number }[] = [];
  private endedAt: number | null = null;
  /** подряд отброшенных «слишком быстрых» фиксов */
  private glitchStreak = 0;

  constructor(type: WorkoutType, weightKg: number, startedAt: number) {
    this.type = type;
    this.weightKg = weightKg;
    this.startedAt = startedAt;
  }

  get state(): LiveStats['state'] {
    if (this.endedAt !== null) return 'finished';
    return this.pauses.length && this.pauses[this.pauses.length - 1][1] === null ? 'paused' : 'running';
  }

  pause(t: number): void {
    if (this.state !== 'running') return;
    this.pauses.push([t, null]);
    this.last = null; // после паузы не соединяем линией старую и новую точки
  }

  resume(t: number): void {
    if (this.state !== 'paused') return;
    this.pauses[this.pauses.length - 1][1] = t;
  }

  /** Сумма пауз до момента t (мс). */
  private pausedBefore(t: number): number {
    let s = 0;
    for (const [a, b] of this.pauses) {
      const end = b ?? t;
      if (a >= t) break;
      s += Math.min(end, t) - a;
    }
    return s;
  }

  /** Чистое время тренировки на момент t, с. */
  elapsedAt(t: number): number {
    return Math.max(0, (t - this.startedAt - this.pausedBefore(t)) / 1000);
  }

  /** Принимает фикс. Возвращает true, если он учтён. */
  addFix(f: WorkoutFix): boolean {
    if (this.state !== 'running') return false;
    if (f.accuracy !== undefined && f.accuracy > MAX_ACCURACY) return false;
    const prev = this.last;
    if (!prev) {
      this.last = f;
      this.keepPoint(f);
      this.clock.push({ d: this.distanceM, t: f.t });
      this.altitude(f);
      this.markCells(f, f);
      return true;
    }
    const dt = (f.t - prev.t) / 1000;
    if (dt <= 0) return false;
    const d = haversine(prev, f);
    if (d < MIN_STEP) return false; // стоим / дрожание — «якорь» не двигаем, время накапливается
    const speed = d / dt;
    if (speed > MAX_SPEED[this.type]) {
      // сбой GPS или «телепорт». Если так повторяется несколько раз подряд — считаем, что
      // теперь реально находимся в новой точке: переносим «якорь» без учёта расстояния.
      if (++this.glitchStreak >= 3) {
        this.glitchStreak = 0;
        this.last = f;
        this.keepPoint(f);
      }
      return false;
    }
    this.glitchStreak = 0;
    this.distanceM += d;
    if (dt <= MAX_GAP_S && speed >= 0.4) {
      this.movingMs += dt * 1000;
      this.calories += metFor(this.type, speed * 3.6) * this.weightKg * (dt / 3600);
    }
    if (speed > this.maxSpeed && dt >= 2) this.maxSpeed = speed;
    this.markCells(prev, f);
    this.altitude(f);
    this.pushClock(prev, f, d);
    this.keepPoint(f);
    this.last = f;
    return true;
  }

  private markCells(a: LngLat, b: LngLat): void {
    const fresh = a === b ? this.grid.reveal(b, CORRIDOR_RADIUS) : this.grid.revealSegment(a, b, CORRIDOR_RADIUS);
    for (const k of fresh) this.corridorM2 += cellArea(keyY(k));
  }

  /** Фиксирует пройденные километры; время пересечения — линейной интерполяцией между фиксами. */
  private pushClock(prev: WorkoutFix, f: WorkoutFix, d: number): void {
    const d0 = this.distanceM - d;
    const d1 = this.distanceM;
    let km = this.splits.length + 1;
    while (km * 1000 <= d1) {
      const frac = (km * 1000 - d0) / d;
      const tc = prev.t + frac * (f.t - prev.t);
      const elapsed = this.elapsedAt(tc);
      const prevElapsed = this.splits.length ? this.splits.reduce((s, x) => s + x.timeS, 0) : 0;
      const timeS = elapsed - prevElapsed;
      this.splits.push({ km, timeS, paceS: timeS });
      km++;
    }
    this.clock.push({ d: d1, t: f.t });
    if (this.clock.length > 400) this.clock.splice(0, this.clock.length - 400);
  }

  private altitude(f: WorkoutFix): void {
    if (f.alt === null || f.alt === undefined) return;
    if (f.altAccuracy !== null && f.altAccuracy !== undefined && f.altAccuracy > 20) return;
    if (this.refAlt === null) {
      this.refAlt = f.alt;
      this.elevGain = 0;
      return;
    }
    // гистерезис 3 м: мелкий шум высоты не накапливается
    if (f.alt - this.refAlt >= 3) {
      this.elevGain = (this.elevGain ?? 0) + (f.alt - this.refAlt);
      this.refAlt = f.alt;
    } else if (this.refAlt - f.alt >= 3) {
      this.refAlt = f.alt;
    }
  }

  private keepPoint(f: WorkoutFix): void {
    const lastP = this.points[this.points.length - 1];
    if (lastP) {
      const d = haversine({ lng: lastP[0], lat: lastP[1] }, f);
      if (d < KEEP_EVERY_M && f.t - lastP[2] < KEEP_EVERY_S * 1000) return;
    }
    this.points.push([+f.lng.toFixed(6), +f.lat.toFixed(6), f.t, f.alt ?? null]);
  }

  /** Текущая дистанция/время за последние windowS секунд по накопленным точкам. */
  private recent(windowS: number): { d: number; s: number } | null {
    const c = this.clock;
    if (c.length < 2) return null;
    const end = c[c.length - 1];
    let i = c.length - 1;
    while (i > 0 && end.t - c[i - 1].t <= windowS * 1000) i--;
    const start = c[i];
    const s = (end.t - start.t) / 1000;
    if (s < 3) return null;
    return { d: end.d - start.d, s };
  }

  live(now: number): LiveStats {
    const elapsedS = this.state === 'finished' ? this.elapsedAt(this.endedAt!) : this.elapsedAt(now);
    const movingS = this.movingMs / 1000;
    const rec = this.recent(WINDOW_S);
    const rec10 = this.recent(10);
    return {
      state: this.state,
      elapsedS,
      movingS,
      distanceM: this.distanceM,
      avgPaceS: this.distanceM >= 20 && movingS > 0 ? movingS / (this.distanceM / 1000) : null,
      currentPaceS: rec && rec.d >= 15 ? rec.s / (rec.d / 1000) : null,
      speed: rec10 ? rec10.d / rec10.s : 0,
      calories: this.calories,
      corridorM2: this.corridorM2,
      elevGainM: this.elevGain,
      splits: this.splits,
      points: this.points.length,
    };
  }

  /** Точки маршрута (для отрисовки) как [lng, lat]. */
  route(): [number, number][] {
    return this.points.map((p) => [p[0], p[1]]);
  }

  /** Завершает тренировку и возвращает запись для сохранения. */
  finish(now: number, id: string): Workout {
    if (this.state === 'paused') this.resume(now);
    this.endedAt = now;
    const s = this.live(now);
    const pts = this.points.map((p): LngLat => ({ lng: p[0], lat: p[1] }));
    let enclosed = 0;
    let kind: Workout['enclosedKind'] = null;
    if (pts.length >= 3 && this.distanceM >= 100) {
      const closeEnough = haversine(pts[0], pts[pts.length - 1]) <= Math.max(60, this.distanceM * 0.05);
      if (closeEnough && this.distanceM >= 300) {
        enclosed = polygonAreaM2(pts);
        kind = 'loop';
      } else {
        enclosed = polygonAreaM2(convexHull(pts));
        kind = 'hull';
      }
    }
    const paces = this.splits.map((x) => x.paceS);
    return {
      id,
      type: this.type,
      startedAt: this.startedAt,
      endedAt: now,
      elapsedS: s.elapsedS,
      movingS: s.movingS,
      distanceM: this.distanceM,
      avgSpeed: s.movingS > 0 ? this.distanceM / s.movingS : 0,
      maxSpeed: this.maxSpeed,
      avgPaceS: s.avgPaceS ?? 0,
      bestPaceS: paces.length ? Math.min(...paces) : null,
      calories: Math.round(this.calories),
      weightKg: this.weightKg,
      elevGainM: this.elevGain === null ? null : Math.round(this.elevGain),
      corridorM2: this.corridorM2,
      enclosedM2: enclosed,
      enclosedKind: kind,
      splits: this.splits,
      points: this.points,
    };
  }

  // ---------- Сохранение на случай закрытия приложения ----------

  serialize(): string {
    const snap: Snapshot = {
      type: this.type,
      weightKg: this.weightKg,
      startedAt: this.startedAt,
      pauses: this.pauses,
      points: this.points,
      distanceM: this.distanceM,
      movingMs: this.movingMs,
      calories: this.calories,
      splits: this.splits,
      maxSpeed: this.maxSpeed,
      elevGain: this.elevGain,
      refAlt: this.refAlt,
      corridorM2: this.corridorM2,
      last: this.last,
      splitClock: this.clock,
    };
    return JSON.stringify(snap);
  }

  static restore(json: string): WorkoutTracker {
    const s = JSON.parse(json) as Snapshot;
    const t = new WorkoutTracker(s.type, s.weightKg, s.startedAt);
    t.pauses = s.pauses;
    t.points = s.points;
    t.distanceM = s.distanceM;
    t.movingMs = s.movingMs;
    t.calories = s.calories;
    t.splits = s.splits;
    t.maxSpeed = s.maxSpeed;
    t.elevGain = s.elevGain;
    t.refAlt = s.refAlt;
    t.corridorM2 = s.corridorM2;
    t.clock = s.splitClock;
    // сетку полосы восстанавливаем по сохранённым точкам
    for (let i = 0; i < s.points.length; i++) {
      const p = { lng: s.points[i][0], lat: s.points[i][1] };
      if (i === 0) t.grid.reveal(p, CORRIDOR_RADIUS);
      else t.grid.revealSegment({ lng: s.points[i - 1][0], lat: s.points[i - 1][1] }, p, CORRIDOR_RADIUS);
    }
    return t;
  }
}

// ---------- Форматирование ----------

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Темп «мин:сек» на км (или на милю). */
export function formatPace(paceS: number | null, imperial = false): string {
  if (paceS === null || !isFinite(paceS) || paceS <= 0 || paceS > 3600) return '–:––';
  const p = imperial ? paceS * 1.609344 : paceS;
  let m = Math.floor(p / 60);
  let sec = Math.round(p % 60);
  if (sec === 60) {
    m++;
    sec = 0;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}
