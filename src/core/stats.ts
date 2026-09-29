// Агрегаты для графиков статистики (чистые функции).

import type { DayLog } from './days';
import { emptyDay } from './days';
import { haversine } from './geo';
import type { TrackPoint } from './gpx';

export type Period = 7 | 30 | 90 | 0; // 0 — всё время

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta, 12);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/** Ряд подряд идущих дней за период (пропуски — нулями). */
export function series(days: DayLog[], today: string, period: Period): DayLog[] {
  const map = new Map(days.map((d) => [d.date, d]));
  let n: number = period;
  if (period === 0) {
    const first = days.filter((d) => d.distanceM > 0 || d.cells > 0 || d.notes > 0).map((d) => d.date).sort()[0];
    if (!first) return [emptyDay(today)];
    const [y, m, d] = first.split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    n = Math.max(7, Math.round((new Date(ty, tm - 1, td, 12).getTime() - new Date(y, m - 1, d, 12).getTime()) / 86400000) + 1);
  }
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(today, -(n - 1 - i));
    return map.get(date) ?? emptyDay(date);
  });
}

export const sum = (xs: DayLog[], k: 'distanceM' | 'areaM2' | 'notes' | 'cells'): number => xs.reduce((s, d) => s + d[k], 0);

/** Изменение к предыдущему периоду такой же длины (доля, null — не с чем сравнивать). */
export function deltaVsPrevious(days: DayLog[], today: string, period: 7 | 30 | 90, k: 'distanceM' | 'areaM2' | 'notes'): number | null {
  const cur = sum(series(days, today, period), k);
  const prev = sum(series(days, addDays(today, -period), period), k);
  if (prev <= 0) return null;
  return (cur - prev) / prev;
}

/**
 * Накопленная площадь: точки (индекс дня → накопленное значение), начиная с накопленного «до периода».
 * base — то, что не привязано к дням (ручное открытие/закрытие тумана): общая площадь минус сумма по дням.
 */
export function cumulative(all: DayLog[], window: DayLog[], k: 'areaM2' | 'distanceM', base = 0): number[] {
  const first = window[0]?.date ?? '';
  let acc = base + all.filter((d) => d.date < first).reduce((s, d) => s + d[k], 0);
  return window.map((d) => Math.max(0, (acc += d[k])));
}

/** Средняя дистанция по дням недели (пн…вс) среди недель, где была активность. */
export function weekdayAverages(days: DayLog[]): number[] {
  const tot = Array(7).fill(0);
  const cnt = Array(7).fill(0);
  for (const d of days) {
    const [y, m, day] = d.date.split('-').map(Number);
    const wd = (new Date(y, m - 1, day, 12).getDay() + 6) % 7; // 0 = понедельник
    tot[wd] += d.distanceM;
    cnt[wd] += 1;
  }
  return tot.map((t, i) => (cnt[i] ? t / cnt[i] : 0));
}

/** Минуты движения по часам суток (0…23) по точкам треков. */
export function hourHistogram(tracks: { points: TrackPoint[] }[]): number[] {
  const bins = Array(24).fill(0);
  for (const tr of tracks) {
    for (let i = 1; i < tr.points.length; i++) {
      const a = tr.points[i - 1];
      const b = tr.points[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0 || dt > 300) continue;
      if (haversine(a, b) / dt < 0.3) continue; // стоим
      bins[new Date(a.t).getHours()] += dt / 60;
    }
  }
  return bins;
}

/** Тепловая карта-календарь: weeks × 7 (пн…вс), уровни 0…4 по квантилям ненулевых дней. */
export function calendarHeat(days: DayLog[], today: string, weeks = 13): { date: string; level: number; value: number; future: boolean }[][] {
  const map = new Map(days.map((d) => [d.date, d.distanceM + (d.workoutM ?? 0)]));
  const [y, m, d] = today.split('-').map(Number);
  const wd = (new Date(y, m - 1, d, 12).getDay() + 6) % 7;
  const endMonday = addDays(today, -wd);
  const start = addDays(endMonday, -(weeks - 1) * 7);
  const values = [...map.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
  const t1 = q(0.25);
  const t2 = q(0.5);
  const t3 = q(0.75);
  const out: { date: string; level: number; value: number; future: boolean }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(start, w * 7 + i);
      const v = map.get(date) ?? 0;
      const level = v <= 0 ? 0 : v <= t1 ? 1 : v <= t2 ? 2 : v <= t3 ? 3 : 4;
      col.push({ date, level, value: v, future: date > today });
    }
    out.push(col);
  }
  return out;
}

export function categoryBreakdown(notes: { category: string }[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) m.set(n.category, (m.get(n.category) ?? 0) + 1);
  return [...m].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}

/** «Красивая» верхняя граница оси. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
