import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, cardinal, destination, formatArea, formatDistance, haversine, latToY, lngToX, xToLng, yToLat } from '../src/core/geo';
import { CELL_ZOOM, FogGrid, cellArea, cellCenter, cellKey, cellOf, cellSizeMeters, inZone, keyX, keyY, type ExclusionZone } from '../src/core/fog';
import { baseXp, levelFromXp, xpForLevel, MAX_LEVEL } from '../src/core/levels';
import { CHALLENGES, EMPTY_STATS, dailyQuests, evaluateChallenges, newlyCompleted } from '../src/core/challenges';
import { computeStreaks, dateKey, lastDays } from '../src/core/days';
import { toGpx } from '../src/core/gpx';

const monaco = { lng: 7.4246, lat: 43.7384 };

describe('geo', () => {
  it('haversine: 1° долготы на экваторе ≈ 111.19 км', () => {
    expect(haversine({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })).toBeCloseTo(111195, -2);
  });
  it('bearing: стороны света', () => {
    const o = { lng: 10, lat: 50 };
    expect(bearing(o, { lng: 10, lat: 51 })).toBeCloseTo(0, 3);
    expect(bearing(o, { lng: 11, lat: 50 })).toBeGreaterThan(89);
    expect(bearing(o, { lng: 10, lat: 49 })).toBeCloseTo(180, 3);
    expect(bearing(o, { lng: 9, lat: 50 })).toBeGreaterThan(269);
  });
  it('destination обратна haversine/bearing', () => {
    const p = destination(monaco, 45, 1234);
    expect(haversine(monaco, p)).toBeCloseTo(1234, 0);
    expect(bearing(monaco, p)).toBeCloseTo(45, 1);
  });
  it('angleDiff — кратчайшая разность', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
  it('Mercator туда-обратно', () => {
    expect(xToLng(lngToX(37.6))).toBeCloseTo(37.6, 9);
    expect(yToLat(latToY(55.75))).toBeCloseTo(55.75, 9);
  });
  it('cardinal и форматирование', () => {
    expect(cardinal(0)).toBe('С');
    expect(cardinal(135)).toBe('ЮВ');
    expect(cardinal(359, 'en')).toBe('N');
    expect(formatDistance(420)).toBe('420 м');
    expect(formatDistance(1500)).toBe('1.50 км');
    expect(formatDistance(1500, 'metric', 'en')).toBe('1.50 km');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatArea(2_500_000)).toBe('2.50 км²');
  });
});

describe('fog grid', () => {
  it('ячейка ↔ координаты', () => {
    const c = cellOf(monaco);
    const back = cellCenter(c.x, c.y);
    expect(Math.abs(back.lng - monaco.lng)).toBeLessThan(0.0004);
    expect(Math.abs(back.lat - monaco.lat)).toBeLessThan(0.0003);
    expect(keyX(cellKey(c.x, c.y))).toBe(c.x);
    expect(keyY(cellKey(c.x, c.y))).toBe(c.y);
    expect(CELL_ZOOM).toBe(20);
  });
  it('размер ячейки ~27 м в Монако и ~38 м на экваторе', () => {
    expect(cellSizeMeters(cellOf(monaco).y)).toBeGreaterThan(26);
    expect(cellSizeMeters(cellOf(monaco).y)).toBeLessThan(28.5);
    expect(cellSizeMeters(cellOf({ lng: 0, lat: 0 }).y)).toBeGreaterThan(37);
    expect(cellArea(cellOf(monaco).y)).toBeCloseTo(cellSizeMeters(cellOf(monaco).y) ** 2, 6);
  });
  it('reveal открывает круг, площадь ≈ π r²', () => {
    const g = new FogGrid();
    const r = 200;
    const fresh = g.reveal(monaco, r);
    expect(fresh.length).toBe(g.count);
    const { areaM2 } = g.measure();
    expect(areaM2 / (Math.PI * r * r)).toBeGreaterThan(0.85);
    expect(areaM2 / (Math.PI * r * r)).toBeLessThan(1.15);
    // повторное открытие ничего не даёт
    expect(g.reveal(monaco, r).length).toBe(0);
  });
  it('revealSegment не оставляет дыр вдоль пути', () => {
    const g = new FogGrid();
    const end = destination(monaco, 90, 1000);
    g.revealSegment(monaco, end, 60);
    for (let d = 0; d <= 1000; d += 25) {
      const c = cellOf(destination(monaco, 90, d));
      expect(g.has(c.x, c.y)).toBe(true);
    }
  });
  it('исключённая зона: не открывается и не считается', () => {
    const zone: ExclusionZone = { id: 'z', name: 'Дом', ...monaco, radius: 150 };
    const g = new FogGrid();
    g.reveal(monaco, 300, (c) => !inZone(c, zone));
    const inside = g.measure([zone]);
    const all = g.measure();
    expect(inside.cells).toBe(all.cells); // ничего внутри зоны не открыто
    // а если зону добавили позже, ячейки внутри исключаются из статистики
    const g2 = new FogGrid();
    g2.reveal(monaco, 300);
    expect(g2.measure([zone]).cells).toBeLessThan(g2.measure().cells);
  });
  it('чанки: сохранение и загрузка без потерь', () => {
    const g = new FogGrid();
    g.revealSegment(monaco, destination(monaco, 30, 3000), 60);
    const chunks = g.takeDirty();
    expect(g.takeDirty()).toHaveLength(0);
    const g2 = new FogGrid();
    for (const c of chunks) g2.loadChunk(c.key, c.cells);
    expect(g2.count).toBe(g.count);
    expect(g2.measure().areaM2).toBeCloseTo(g.measure().areaM2, 3);
  });
  it('forEachInRect отдаёт только видимое', () => {
    const g = new FogGrid();
    g.reveal(monaco, 500);
    const c = cellOf(monaco);
    let n = 0;
    g.forEachInRect(c.x - 3, c.y - 3, c.x + 3, c.y + 3, () => n++);
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(g.count);
  });
  it('bounds', () => {
    const g = new FogGrid();
    expect(g.bounds()).toBeNull();
    g.reveal(monaco, 100);
    const b = g.bounds()!;
    expect(b.west).toBeLessThan(monaco.lng);
    expect(b.east).toBeGreaterThan(monaco.lng);
    expect(b.north).toBeGreaterThan(monaco.lat);
    expect(b.south).toBeLessThan(monaco.lat);
  });
});

describe('уровни', () => {
  it('xpForLevel монотонна', () => {
    for (let l = 1; l < MAX_LEVEL; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(xpForLevel(1)).toBe(0);
  });
  it('levelFromXp: границы', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(xpForLevel(5) - 1).level).toBe(4);
    expect(levelFromXp(xpForLevel(5)).level).toBe(5);
    const l = levelFromXp(xpForLevel(5) + 1);
    expect(l.progress).toBeGreaterThan(0);
    expect(l.progress).toBeLessThan(1);
    expect(levelFromXp(1e9).maxed).toBe(true);
    expect(levelFromXp(1e9).level).toBe(MAX_LEVEL);
  });
  it('baseXp', () => {
    expect(baseXp({ areaM2: 30000, notes: 2, photos: 3, videos: 1, distanceM: 500 })).toBe(20 + 50 + 15 + 10 + 10);
  });
});

describe('челленджи', () => {
  it('id уникальны', () => {
    expect(new Set(CHALLENGES.map((c) => c.id)).size).toBe(CHALLENGES.length);
  });
  it('прогресс и выполнение', () => {
    const s = { ...EMPTY_STATS, distanceM: 6000, notes: 1 };
    const st = evaluateChallenges(s, {});
    expect(st.find((c) => c.def.id === 'dist_1')!.done).toBe(true);
    expect(st.find((c) => c.def.id === 'dist_5')!.done).toBe(true);
    expect(st.find((c) => c.def.id === 'dist_10')!.progress).toBeCloseTo(0.6, 5);
    expect(newlyCompleted(s, { dist_1: 1 }).map((c) => c.id)).toContain('dist_5');
    expect(newlyCompleted(s, { dist_1: 1 }).map((c) => c.id)).not.toContain('dist_1');
  });
  it('ежедневные задания детерминированы по дате', () => {
    const a = dailyQuests('2026-09-28', EMPTY_STATS.today, {});
    const b = dailyQuests('2026-09-28', EMPTY_STATS.today, {});
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    const done = dailyQuests('2026-09-28', { cells: 0, areaM2: 1e9, distanceM: 1e9, notes: 99 }, {});
    expect(done.every((q) => q.done)).toBe(true);
  });
});

describe('серии дней', () => {
  const d = (date: string) => ({ date, cells: 1, areaM2: 1, distanceM: 200, notes: 0 });
  it('считает текущую и лучшую серии', () => {
    const days = [d('2026-09-20'), d('2026-09-21'), d('2026-09-22'), d('2026-09-26'), d('2026-09-27'), d('2026-09-28')];
    expect(computeStreaks(days, '2026-09-28')).toEqual({ current: 3, best: 3 });
    expect(computeStreaks(days, '2026-09-29')).toEqual({ current: 3, best: 3 });
    expect(computeStreaks(days, '2026-10-05')).toEqual({ current: 0, best: 3 });
    expect(computeStreaks([], '2026-09-28')).toEqual({ current: 0, best: 0 });
  });
  it('переход через месяц и lastDays', () => {
    const days = [d('2026-08-31'), d('2026-09-01')];
    expect(computeStreaks(days, '2026-09-01').current).toBe(2);
    const ld = lastDays(days, '2026-09-03', 4);
    expect(ld.map((x) => x.date)).toEqual(['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03']);
    expect(dateKey(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
  });
});

describe('gpx', () => {
  it('экранирует XML и содержит трек и точки', () => {
    const xml = toGpx([{ name: 'День <1>', points: [{ lng: 7.4, lat: 43.7, t: 0 }] }], [{ lng: 7.4, lat: 43.7, name: 'Кафе & бар' }]);
    expect(xml).toContain('Кафе &amp; бар');
    expect(xml).toContain('День &lt;1&gt;');
    expect(xml).toContain('<trkpt lat="43.700000" lon="7.400000">');
  });
});
