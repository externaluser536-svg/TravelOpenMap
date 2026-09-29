// Планирование поездок: даты, статусы, обратный отсчёт, бюджет, шаблоны чек-листов.

import type { ExpenseCategory, Trip, TripExpense, TripStatus } from '../data/db';

export const STATUSES: TripStatus[] = ['idea', 'planned', 'booked', 'done', 'cancelled'];
export const TRANSPORTS = ['plane', 'train', 'car', 'bus', 'ship', 'bike', 'other'] as const;
export const EXPENSE_CATEGORIES: ExpenseCategory[] = ['transport', 'stay', 'food', 'fun', 'shopping', 'other'];

const DAY = 86400000;

export function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day, 12);
}

export function fmtDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayKey = (): string => fmtDateKey(new Date());

/** Число суток между датами (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY);
}

export function addDaysKey(d: string, n: number): string {
  return fmtDateKey(new Date(parseDate(d).getTime() + n * DAY));
}

export const hasDates = (t: Pick<Trip, 'startDate' | 'endDate'>): boolean => !!t.startDate && !!t.endDate;

/** Все даты поездки (включительно). */
export function tripDays(t: Pick<Trip, 'startDate' | 'endDate'>): string[] {
  if (!hasDates(t)) return [];
  const n = daysBetween(t.startDate, t.endDate);
  if (n < 0 || n > 366) return [];
  return Array.from({ length: n + 1 }, (_, i) => addDaysKey(t.startDate, i));
}

export function nights(t: Pick<Trip, 'startDate' | 'endDate'>): number {
  return hasDates(t) ? Math.max(0, daysBetween(t.startDate, t.endDate)) : 0;
}

export type TripPhase = 'undated' | 'upcoming' | 'ongoing' | 'past';

export function phaseOf(t: Pick<Trip, 'startDate' | 'endDate'>, today = todayKey()): TripPhase {
  if (!hasDates(t)) return 'undated';
  if (today < t.startDate) return 'upcoming';
  if (today > t.endDate) return 'past';
  return 'ongoing';
}

/** Дней до начала (отрицательно — уже идёт/прошла); null — без дат. */
export function daysUntil(t: Pick<Trip, 'startDate'>, today = todayKey()): number | null {
  return t.startDate ? daysBetween(today, t.startDate) : null;
}

export function validateDates(start: string, end: string): 'ok' | 'order' | 'toolong' {
  if (!start || !end) return 'ok';
  const n = daysBetween(start, end);
  if (n < 0) return 'order';
  if (n > 365) return 'toolong';
  return 'ok';
}

// ---------- Бюджет ----------

export function expenseTotal(list: TripExpense[]): number {
  return list.reduce((s, e) => s + (isFinite(e.amount) ? e.amount : 0), 0);
}

export function expensesByCategory(list: TripExpense[]): { category: ExpenseCategory; amount: number }[] {
  const m = new Map<ExpenseCategory, number>();
  for (const e of list) m.set(e.category, (m.get(e.category) ?? 0) + e.amount);
  return EXPENSE_CATEGORIES.map((c) => ({ category: c, amount: m.get(c) ?? 0 })).filter((x) => x.amount > 0);
}

export function budgetState(t: Pick<Trip, 'budget' | 'expenses' | 'travelers'>): { spent: number; left: number; ratio: number; perPerson: number; over: boolean } {
  const spent = expenseTotal(t.expenses);
  const ratio = t.budget > 0 ? spent / t.budget : 0;
  return { spent, left: t.budget - spent, ratio, perPerson: t.travelers > 0 ? spent / t.travelers : spent, over: t.budget > 0 && spent > t.budget };
}

// ---------- Чек-лист ----------

export interface ChecklistTemplate {
  group: string;
  keys: string[];
}

/** Ключи i18n для шаблона сборов (`check.<ключ>`). */
export const CHECKLIST_TEMPLATE: ChecklistTemplate[] = [
  { group: 'docs', keys: ['passport', 'visa', 'tickets', 'insurance', 'booking', 'cards'] },
  { group: 'clothes', keys: ['underwear', 'shoes', 'jacket', 'swimwear', 'hat'] },
  { group: 'tech', keys: ['phone_charger', 'powerbank', 'adapter', 'headphones', 'offline_maps'] },
  { group: 'health', keys: ['meds', 'firstaid', 'sunscreen', 'hygiene'] },
];

export function checklistProgress(list: { done: boolean }[]): { done: number; total: number; ratio: number } {
  const done = list.filter((x) => x.done).length;
  return { done, total: list.length, ratio: list.length ? done / list.length : 0 };
}

// ---------- Группировка и таймлайн ----------

export function groupTrips(trips: Trip[], today = todayKey()): { ongoing: Trip[]; upcoming: Trip[]; ideas: Trip[]; past: Trip[] } {
  const live = trips.filter((t) => t.status !== 'cancelled');
  const byStart = (a: Trip, b: Trip) => (a.startDate || '9999').localeCompare(b.startDate || '9999');
  const ongoing = live.filter((t) => phaseOf(t, today) === 'ongoing' && t.status !== 'idea' && t.status !== 'done').sort(byStart);
  const upcoming = live.filter((t) => phaseOf(t, today) === 'upcoming' && t.status !== 'idea' && t.status !== 'done').sort(byStart);
  const ideas = live.filter((t) => t.status === 'idea' || (phaseOf(t, today) === 'undated' && t.status !== 'done')).sort(byStart);
  const past = trips
    .filter((t) => !ongoing.includes(t) && !upcoming.includes(t) && !ideas.includes(t))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
  return { ongoing, upcoming, ideas, past };
}

/** Полосы поездок на шкале из span суток, начинающейся с даты start: доли 0…1. */
export function timelineBars(trips: Trip[], start: string, span: number): { id: string; from: number; to: number }[] {
  const end = addDaysKey(start, span - 1);
  const out: { id: string; from: number; to: number }[] = [];
  for (const t of trips) {
    if (!hasDates(t) || t.status === 'cancelled') continue;
    if (t.endDate < start || t.startDate > end) continue;
    const a = Math.max(0, daysBetween(start, t.startDate));
    const b = Math.min(span - 1, daysBetween(start, t.endDate));
    out.push({ id: t.id, from: a / span, to: (b + 1) / span });
  }
  return out;
}

/** То же для календарного года. */
export function yearTimeline(trips: Trip[], year: number): { id: string; from: number; to: number }[] {
  return timelineBars(trips, `${year}-01-01`, 365);
}

export function newTrip(id: string, now: number, currency = 'EUR'): Trip {
  return {
    id,
    title: '',
    country: '',
    destination: '',
    startDate: '',
    endDate: '',
    status: 'idea',
    transport: 'plane',
    travelers: 1,
    budget: 0,
    currency,
    notes: '',
    items: [],
    expenses: [],
    checklist: [],
    createdAt: now,
    updatedAt: now,
  };
}
