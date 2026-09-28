// Дневная статистика и серии активных дней.

export interface DayLog {
  /** локальная дата YYYY-MM-DD */
  date: string;
  cells: number;
  areaM2: number;
  distanceM: number;
  notes: number;
}

export function dateKey(t: number = Date.now()): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export const emptyDay = (date: string): DayLog => ({ date, cells: 0, areaM2: 0, distanceM: 0, notes: 0 });

export function isActiveDay(d: DayLog): boolean {
  return d.distanceM >= 100 || d.cells > 0 || d.notes > 0;
}

function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta, 12);
  return dateKey(dt.getTime());
}

/** Текущая и лучшая серии подряд идущих активных дней. Серия «жива», если последний активный день — сегодня или вчера. */
export function computeStreaks(days: DayLog[], today: string): { current: number; best: number } {
  const active = new Set(days.filter(isActiveDay).map((d) => d.date));
  if (!active.size) return { current: 0, best: 0 };
  const sorted = [...active].sort();
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = addDays(sorted[i - 1], 1) === sorted[i] ? run + 1 : 1;
    if (run > best) best = run;
  }
  let current = 0;
  let cursor = active.has(today) ? today : addDays(today, -1);
  while (active.has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  return { current, best: Math.max(best, current) };
}

/** Последние n дней (включая сегодня) — для графика активности. */
export function lastDays(days: DayLog[], today: string, n: number): DayLog[] {
  const map = new Map(days.map((d) => [d.date, d]));
  const out: DayLog[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    out.push(map.get(date) ?? emptyDay(date));
  }
  return out;
}
