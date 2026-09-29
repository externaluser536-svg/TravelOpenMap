import { describe, expect, it } from 'vitest';
import {
  addDaysKey, budgetState, checklistProgress, daysBetween, daysUntil, expensesByCategory, groupTrips, newTrip, nights, phaseOf, tripDays, validateDates, yearTimeline,
} from '../src/core/trips';
import { calendarHeat, categoryBreakdown, cumulative, deltaVsPrevious, hourHistogram, niceMax, series, sum, weekdayAverages } from '../src/core/stats';
import type { DayLog } from '../src/core/days';

const trip = (id: string, s: string, e: string, status: 'idea' | 'planned' | 'booked' | 'done' | 'cancelled' = 'planned') => ({ ...newTrip(id, 0), startDate: s, endDate: e, status });

describe('поездки', () => {
  it('даты: разница, диапазон, ночи, переход через месяц и год', () => {
    expect(daysBetween('2026-09-28', '2026-10-03')).toBe(5);
    expect(addDaysKey('2026-12-30', 3)).toBe('2027-01-02');
    expect(tripDays({ startDate: '2026-10-30', endDate: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(nights({ startDate: '2026-10-30', endDate: '2026-11-02' })).toBe(3);
    expect(tripDays({ startDate: '', endDate: '' })).toEqual([]);
    expect(validateDates('2026-10-05', '2026-10-01')).toBe('order');
    expect(validateDates('2026-10-01', '2028-10-01')).toBe('toolong');
    expect(validateDates('2026-10-01', '2026-10-05')).toBe('ok');
  });
  it('фаза и обратный отсчёт', () => {
    const t = { startDate: '2026-10-10', endDate: '2026-10-15' };
    expect(phaseOf(t, '2026-10-01')).toBe('upcoming');
    expect(phaseOf(t, '2026-10-12')).toBe('ongoing');
    expect(phaseOf(t, '2026-10-16')).toBe('past');
    expect(phaseOf({ startDate: '', endDate: '' })).toBe('undated');
    expect(daysUntil(t, '2026-10-01')).toBe(9);
  });
  it('группировка: идёт / скоро / идеи / архив (в т.ч. отменённые)', () => {
    const ts = [
      trip('a', '2026-10-01', '2026-10-05'), trip('b', '2026-12-01', '2026-12-10', 'booked'), trip('c', '', '', 'idea'),
      trip('d', '2026-01-01', '2026-01-05', 'done'), trip('e', '2026-11-01', '2026-11-02', 'cancelled'), trip('f', '2026-11-20', '2026-11-25'),
    ];
    const g = groupTrips(ts, '2026-10-03');
    expect(g.ongoing.map((t) => t.id)).toEqual(['a']);
    expect(g.upcoming.map((t) => t.id)).toEqual(['f', 'b']);
    expect(g.ideas.map((t) => t.id)).toEqual(['c']);
    expect(g.past.map((t) => t.id)).toEqual(['e', 'd']); // отменённые — в архиве, чтобы их можно было удалить
  });
  it('бюджет и чек-лист', () => {
    const b = budgetState({ budget: 1000, travelers: 2, expenses: [{ id: '1', title: 'Билеты', amount: 600, category: 'transport' }, { id: '2', title: 'Отель', amount: 500, category: 'stay' }] });
    expect(b.spent).toBe(1100);
    expect(b.over).toBe(true);
    expect(b.left).toBe(-100);
    expect(b.perPerson).toBe(550);
    expect(expensesByCategory([{ id: '1', title: '', amount: 5, category: 'food' }, { id: '2', title: '', amount: 7, category: 'food' }])).toEqual([{ category: 'food', amount: 12 }]);
    expect(checklistProgress([{ done: true }, { done: false }, { done: true }, { done: true }]).ratio).toBe(0.75);
    expect(checklistProgress([]).ratio).toBe(0);
  });
  it('таймлайн года', () => {
    const bars = yearTimeline([trip('a', '2026-01-01', '2026-01-31'), trip('b', '2025-12-25', '2026-01-05'), trip('c', '2027-03-01', '2027-03-05')], 2026);
    expect(bars).toHaveLength(2);
    expect(bars[0].from).toBe(0);
    expect(bars[0].to).toBeCloseTo(31 / 365, 5);
    expect(bars[1].from).toBe(0);
  });
});

const day = (date: string, distanceM = 0, areaM2 = 0, notes = 0, cells = 0): DayLog => ({ date, distanceM, areaM2, notes, cells });

describe('агрегаты статистики', () => {
  const days = [day('2026-09-20', 1000, 5000, 1, 3), day('2026-09-22', 3000, 9000, 0, 4), day('2026-09-28', 2000, 4000, 2, 2), day('2026-09-29', 500, 1000, 0, 1)];
  it('series: заполняет пропуски нулями и «всё время»', () => {
    const s = series(days, '2026-09-29', 7);
    expect(s).toHaveLength(7);
    expect(s[6].date).toBe('2026-09-29');
    expect(sum(s, 'distanceM')).toBe(2500);
    const all = series(days, '2026-09-29', 0);
    expect(all[0].date).toBe('2026-09-20');
    expect(all).toHaveLength(10);
    expect(series([], '2026-09-29', 0)).toHaveLength(1);
  });
  it('изменение к прошлому периоду', () => {
    const d = [day('2026-09-25', 1000), day('2026-09-10', 500)];
    expect(deltaVsPrevious(d, '2026-09-29', 7, 'distanceM')).toBeNull(); // прошлая неделя пуста
    expect(deltaVsPrevious([...d, day('2026-09-18', 500)], '2026-09-29', 7, 'distanceM')).toBe(1);
  });
  it('накопленная площадь учитывает всё, что было до окна', () => {
    const win = series(days, '2026-09-29', 7);
    const cum = cumulative(days, win, 'areaM2');
    expect(cum[0]).toBe(14000); // 5000 + 9000 до 23.09
    expect(cum[cum.length - 1]).toBe(19000);
    expect(cum.every((v, i) => i === 0 || v >= cum[i - 1])).toBe(true);
  });
  it('дни недели, часы, календарь, категории, ось', () => {
    const wd = weekdayAverages(days);
    expect(wd).toHaveLength(7);
    expect(wd[6]).toBe(1000); // 2026-09-20 — воскресенье
    expect(wd[1]).toBe(1750); // вторники 22.09 (3000) и 29.09 (500)
    const t0 = new Date(2026, 8, 28, 7, 0, 0).getTime();
    const hist = hourHistogram([{ points: [0, 1, 2, 3].map((i) => ({ lng: 7.4 + i * 0.0002, lat: 43.7, t: t0 + i * 10000 })) }]);
    expect(hist[7]).toBeGreaterThan(0.4);
    expect(hist.reduce((a, b) => a + b, 0)).toBeCloseTo(hist[7], 5);
    const cal = calendarHeat(days, '2026-09-29', 13);
    expect(cal).toHaveLength(13);
    expect(cal[12].some((c) => c.date === '2026-09-29')).toBe(true);
    expect(cal.flat().find((c) => c.date === '2026-09-22')!.level).toBeGreaterThan(cal.flat().find((c) => c.date === '2026-09-29')!.level);
    expect(categoryBreakdown([{ category: 'a' }, { category: 'b' }, { category: 'a' }])).toEqual([{ category: 'a', count: 2 }, { category: 'b', count: 1 }]);
    expect(niceMax(0)).toBe(1);
    expect(niceMax(3.2)).toBe(5);
    expect(niceMax(1300)).toBe(2000);
  });
});
