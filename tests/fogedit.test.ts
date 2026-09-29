import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELLS_PER_AXIS, FogGrid, cellOf, keyX, keyY, cellArea } from '../src/core/fog';
import { FogEditTooLargeError, cellsInCircle, cellsInPath, cellsInPolygon, circlePolygon, polygonAreaM2 } from '../src/core/fogedit';
import { destination } from '../src/core/geo';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

const monaco = { lng: 7.4246, lat: 43.7384 };

describe('выбор ячеек', () => {
  it('круг совпадает с reveal() по составу ячеек', () => {
    const g = new FogGrid();
    const fresh = g.reveal(monaco, 200);
    const keys = cellsInCircle(monaco, 200);
    expect(new Set(keys)).toEqual(new Set(fresh));
  });

  it('площадь круга ≈ πr²', () => {
    const keys = cellsInCircle(monaco, 500);
    const area = keys.reduce((s, k) => s + cellArea(keyY(k)), 0);
    expect(area / (Math.PI * 500 * 500)).toBeGreaterThan(0.97);
    expect(area / (Math.PI * 500 * 500)).toBeLessThan(1.03);
  });

  it('многоугольник: квадрат 400×400 м даёт ≈ 160 000 м²', () => {
    const a = destination(monaco, 0, 200);
    const sq = [
      destination(destination(monaco, 0, 200), 270, 200),
      destination(destination(monaco, 0, 200), 90, 200),
      destination(destination(monaco, 180, 200), 90, 200),
      destination(destination(monaco, 180, 200), 270, 200),
    ];
    expect(a).toBeTruthy();
    const keys = cellsInPolygon(sq);
    const area = keys.reduce((s, k) => s + cellArea(keyY(k)), 0);
    expect(area / 160000).toBeGreaterThan(0.93);
    expect(area / 160000).toBeLessThan(1.07);
    expect(polygonAreaM2(sq) / 160000).toBeGreaterThan(0.98);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('вогнутый многоугольник не заполняет «вырез»', () => {
    const c = monaco;
    const p = (n: number, e: number) => destination(destination(c, 0, n), 90, e);
    // буква «П»: вырез сверху посередине
    const poly = [p(-200, -200), p(200, -200), p(200, -100), p(0, -100), p(0, 100), p(200, 100), p(200, 200), p(-200, 200)];
    const keys = new Set(cellsInPolygon(poly));
    const inHole = cellOf(p(100, 0));
    const inBody = cellOf(p(-100, 0));
    expect(keys.has(inHole.x * CELLS_PER_AXIS + inHole.y)).toBe(false);
    expect(keys.has(inBody.x * CELLS_PER_AXIS + inBody.y)).toBe(true);
  });

  it('мазок кисти: одна точка — круг, линия — «сосиска» шириной 2r без дублей', () => {
    expect(new Set(cellsInPath([monaco], 120))).toEqual(new Set(cellsInCircle(monaco, 120)));
    const end = destination(monaco, 90, 2000); // ячейка ≈ 27 м, поэтому берём крупный мазок
    const keys = cellsInPath([monaco, end], 250);
    expect(new Set(keys).size).toBe(keys.length);
    const area = keys.reduce((s, k) => s + cellArea(keyY(k)), 0);
    const expected = 2 * 250 * 2000 + Math.PI * 250 * 250;
    expect(area / expected).toBeGreaterThan(0.95);
    expect(area / expected).toBeLessThan(1.05);
    // точка вдали от линии не попадает
    const far = cellsInCircle(destination(monaco, 0, 600), 5)[0];
    expect(keys).not.toContain(far);
    expect(cellsInPath([], 50)).toEqual([]);
  });

  it('слишком большая область отклоняется', () => {
    expect(() => cellsInCircle(monaco, 20000)).toThrow(FogEditTooLargeError);
  });

  it('меньше трёх вершин — пусто; circlePolygon замкнут по радиусу', () => {
    expect(cellsInPolygon([monaco, monaco])).toEqual([]);
    expect(polygonAreaM2(circlePolygon(monaco, 300)) / (Math.PI * 300 * 300)).toBeGreaterThan(0.99);
  });

  it('FogGrid.remove убирает ячейку и помечает чанк изменённым', () => {
    const g = new FogGrid();
    g.add(100, 100);
    g.takeDirty();
    expect(g.remove(100, 100)).toBe(true);
    expect(g.remove(100, 100)).toBe(false);
    expect(g.count).toBe(0);
    const d = g.takeDirty();
    expect(d).toHaveLength(1);
    expect(d[0].cells.length).toBe(0);
  });
});

describe('движок: ручная правка тумана', () => {
  let engine: typeof import('../src/state/engine').engine;
  let useApp: typeof import('../src/state/store').useApp;
  let usePrefs: typeof import('../src/state/prefs').usePrefs;

  beforeAll(async () => {
    ({ engine } = await import('../src/state/engine'));
    ({ useApp } = await import('../src/state/store'));
    ({ usePrefs } = await import('../src/state/prefs'));
    await engine.init();
  });
  beforeEach(async () => {
    engine.quiet = true;
    await engine.resetAll();
    usePrefs.getState().set({ zones: [], completed: {} });
  });

  it('открытие добавляет площадь в статистику, но не в дистанцию и не в дневную площадь', () => {
    const r = engine.editFog('open', cellsInCircle(monaco, 300));
    expect(r.changed).toBeGreaterThan(300);
    const s = useApp.getState();
    expect(s.stats.areaM2).toBeCloseTo(r.areaM2, 0);
    expect(s.stats.cells).toBe(engine.grid.count);
    expect(s.stats.distanceM).toBe(0);
    expect(s.stats.today.areaM2).toBe(0);
    expect(s.level.xp).toBeGreaterThan(0);
  });

  it('повторное открытие ничего не меняет; закрытие возвращает туман', () => {
    engine.editFog('open', cellsInCircle(monaco, 200));
    const before = engine.grid.count;
    expect(engine.editFog('open', cellsInCircle(monaco, 200)).changed).toBe(0);
    expect(engine.grid.count).toBe(before);
    const closed = engine.editFog('close', cellsInCircle(monaco, 100));
    expect(closed.changed).toBeGreaterThan(0);
    expect(engine.grid.count).toBe(before - closed.changed);
    expect(useApp.getState().stats.cells).toBe(before - closed.changed);
  });

  it('исключённые зоны при открытии остаются закрытыми', () => {
    usePrefs.getState().set({ zones: [{ id: 'z', name: 'дом', lng: monaco.lng, lat: monaco.lat, radius: 100 }] });
    engine.editFog('open', cellsInCircle(monaco, 300));
    const inner = cellOf(monaco);
    expect(engine.grid.has(inner.x, inner.y)).toBe(false);
    const outer = cellOf(destination(monaco, 90, 200));
    expect(engine.grid.has(outer.x, outer.y)).toBe(true);
  });

  it('отмена возвращает прошлое состояние; закрытие не отнимает выданные награды', async () => {
    engine.editFog('open', cellsInCircle(monaco, 400));
    const opened = engine.grid.count;
    engine.publish();
    const doneBefore = Object.keys(usePrefs.getState().completed).length;
    expect(engine.canUndoFogEdit).toBe(true);
    expect(useApp.getState().canUndoFog).toBe(true);
    engine.undoFogEdit();
    expect(engine.grid.count).toBe(0);
    expect(useApp.getState().canUndoFog).toBe(false);
    engine.editFog('open', cellsInCircle(monaco, 400));
    engine.editFog('close', cellsInCircle(monaco, 400));
    expect(engine.grid.count).toBe(0);
    expect(engine.undoFogEdit()).toBe(opened);
    expect(engine.grid.count).toBe(opened);
    expect(Object.keys(usePrefs.getState().completed).length).toBeGreaterThanOrEqual(doneBefore);
    for (const k of cellsInCircle(monaco, 50)) expect(engine.grid.has(keyX(k), keyY(k))).toBe(true);
  });

  it('отмена и возврат работают много раз подряд', () => {
    engine.editFog('open', cellsInCircle(monaco, 200));
    const a = engine.grid.count;
    engine.editFog('open', cellsInCircle(destination(monaco, 90, 500), 200));
    const b = engine.grid.count;
    engine.editFog('close', cellsInCircle(monaco, 80));
    const c = engine.grid.count;
    expect(engine.canUndoFogEdit).toBe(true);
    expect(engine.canRedoFogEdit).toBe(false);
    engine.undoFogEdit();
    expect(engine.grid.count).toBe(b);
    engine.undoFogEdit();
    expect(engine.grid.count).toBe(a);
    expect(engine.canRedoFogEdit).toBe(true);
    engine.redoFogEdit();
    expect(engine.grid.count).toBe(b);
    engine.redoFogEdit();
    expect(engine.grid.count).toBe(c);
    expect(engine.canRedoFogEdit).toBe(false);
    // новая правка обнуляет «вперёд»
    engine.undoFogEdit();
    engine.editFog('open', cellsInCircle(destination(monaco, 0, 700), 50));
    expect(engine.canRedoFogEdit).toBe(false);
    engine.undoFogEdit();
    engine.undoFogEdit();
    engine.undoFogEdit();
    expect(engine.grid.count).toBe(0);
    expect(engine.canUndoFogEdit).toBe(false);
  });

  it('правка сохраняется в БД и переживает перезагрузку', async () => {
    engine.editFog('open', cellsInCircle(monaco, 300));
    engine.editFog('close', cellsInCircle(monaco, 120));
    const expected = engine.grid.count;
    await engine.flush();
    await engine.reloadFromDb();
    expect(engine.grid.count).toBe(expected);
  });
});
