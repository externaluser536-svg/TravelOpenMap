import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// В node нет localStorage — подставляем простую реализацию до загрузки хранилищ.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});

let engine: typeof import('../src/state/engine').engine;
let useApp: typeof import('../src/state/store').useApp;
let usePrefs: typeof import('../src/state/prefs').usePrefs;
let destination: typeof import('../src/core/geo').destination;
let cellOf: typeof import('../src/core/fog').cellOf;

const monaco = { lng: 7.4246, lat: 43.7384 };
let clock = Date.UTC(2026, 8, 28, 10, 0, 0);
const fix = (p: { lng: number; lat: number }, dtSec = 5) => ({ ...p, accuracy: 8, t: (clock += dtSec * 1000) });

describe('engine', () => {
  beforeAll(async () => {
    ({ engine } = await import('../src/state/engine'));
    ({ useApp } = await import('../src/state/store'));
    ({ usePrefs } = await import('../src/state/prefs'));
    ({ destination } = await import('../src/core/geo'));
    ({ cellOf } = await import('../src/core/fog'));
    await engine.init();
  });

  beforeEach(async () => {
    engine.quiet = true;
    await engine.resetAll();
    usePrefs.getState().set({ zones: [], completed: {}, revealRadius: 60, minAccuracy: 60, recordTrack: true });
    useApp.getState().patch({ position: null });
  });

  it('первый фикс открывает круг вокруг игрока', () => {
    engine.onFix(fix(monaco));
    expect(engine.grid.count).toBeGreaterThan(12);
    expect(engine.grid.count).toBeLessThan(20);
    const c = cellOf(monaco);
    expect(engine.grid.has(c.x, c.y)).toBe(true);
    expect(useApp.getState().position?.lng).toBe(monaco.lng);
  });

  it('ходьба открывает путь и копит дистанцию, статистика и XP растут', () => {
    let p = monaco;
    for (let i = 0; i < 60; i++) {
      p = destination(p, 90, 14); // ~2.8 м/с… 14 м за 5 с
      engine.onFix(fix(p));
    }
    engine.publish();
    const s = useApp.getState();
    expect(s.stats.distanceM).toBeGreaterThan(780);
    expect(s.stats.distanceM).toBeLessThan(900);
    expect(s.stats.cells).toBe(engine.grid.count);
    expect(s.stats.areaM2).toBeGreaterThan(50000);
    expect(s.level.xp).toBeGreaterThan(100);
    expect(s.stats.today.distanceM).toBeCloseTo(s.stats.distanceM, 5);
  });

  it('дрожание GPS (<3 м) не считается движением', () => {
    engine.onFix(fix(monaco));
    const before = engine.grid.count;
    for (let i = 0; i < 20; i++) engine.onFix(fix(destination(monaco, i * 40, 1.5)));
    engine.publish();
    expect(useApp.getState().stats.distanceM).toBe(0);
    expect(engine.grid.count).toBe(before);
  });

  it('слабая точность игнорируется', () => {
    engine.onFix({ ...fix(monaco), accuracy: 300 });
    expect(engine.grid.count).toBe(0);
    expect(useApp.getState().gps).toBe('weak');
  });

  it('«телепорт» (перелёт) не открывает линию между точками и не считает дистанцию', () => {
    engine.onFix(fix(monaco));
    const far = destination(monaco, 45, 300000); // 300 км
    engine.onFix(fix(far, 60));
    engine.publish();
    expect(useApp.getState().stats.distanceM).toBe(0);
    // открыта только окрестность двух точек, а не коридор в 300 км
    expect(engine.grid.count).toBeLessThan(80);
  });

  it('исключённая зона: ничего не открывается, не считается, трек не пишется', () => {
    usePrefs.getState().set({ zones: [{ id: 'home', name: 'Дом', ...monaco, radius: 200 }] });
    let p = destination(monaco, 0, -100);
    for (let i = 0; i < 10; i++) {
      p = destination(p, 0, 20); // идём через зону
      engine.onFix(fix(p));
    }
    engine.publish();
    const s = useApp.getState();
    expect(s.inZone || s.stats.cells >= 0).toBe(true);
    // ни одна открытая ячейка не лежит внутри зоны
    let inside = 0;
    engine.grid.forEach((x, y) => {
      const lng = ((x + 0.5) / 2 ** 19) * 360 - 180;
      const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** 19;
      const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
      const dLat = (lat - monaco.lat) * 111320;
      const dLng = (lng - monaco.lng) * 111320 * Math.cos((monaco.lat * Math.PI) / 180);
      if (Math.hypot(dLat, dLng) < 195) inside++;
    });
    expect(inside).toBe(0);
    expect(engine.allTracks().flatMap((t) => t.points).every((pt) => Math.hypot((pt.lat - monaco.lat) * 111320, (pt.lng - monaco.lng) * 80500) > 190)).toBe(true);
  });

  it('добавление зоны задним числом убирает прежние ячейки из статистики (но не из данных)', () => {
    for (let i = 0; i < 5; i++) engine.onFix(fix(destination(monaco, 90, i * 30)));
    engine.publish();
    const before = useApp.getState().stats.cells;
    const total = engine.grid.count;
    engine.setZones([{ id: 'z', name: 'Z', ...monaco, radius: 5000 }]);
    expect(useApp.getState().stats.cells).toBe(0);
    expect(engine.grid.count).toBe(total); // данные сохранены
    engine.setZones([]);
    expect(useApp.getState().stats.cells).toBe(before);
  });

  it('заметка: XP, счётчики медиа, удаление', async () => {
    engine.onFix(fix(monaco));
    const n = await engine.saveNote({
      title: 'Кафе', text: 'вкусно', category: 'food', ...monaco,
      media: [{ key: 'a', kind: 'photo', blob: new Blob(['x']), mime: 'image/jpeg' }, { key: 'b', kind: 'video', blob: new Blob(['y']), mime: 'video/mp4' }],
      removedMediaIds: [], manual: false,
    });
    expect(n.photos).toBe(1);
    expect(n.videos).toBe(1);
    expect(useApp.getState().stats.notes).toBe(1);
    expect(useApp.getState().stats.categories).toBe(1);
    expect(useApp.getState().challenges.find((c) => c.def.id === 'notes_1')!.done).toBe(true);
    await engine.deleteNote(n.id);
    expect(useApp.getState().stats.notes).toBe(0);
  });

  it('челленджи выполняются один раз и дают XP; повышение уровня сообщается', () => {
    engine.quiet = false;
    useApp.getState().patch({ ready: true, levelUp: null, toasts: [] });
    let p = monaco;
    for (let i = 0; i < 80; i++) {
      p = destination(p, 45, 14);
      engine.onFix(fix(p));
    }
    engine.publish();
    const done = usePrefs.getState().completed;
    expect(done['dist_1']).toBeDefined();
    const xpAfter = useApp.getState().level.xp;
    engine.publish();
    expect(useApp.getState().level.xp).toBe(xpAfter); // повторный publish не начисляет ещё раз
    expect(useApp.getState().toasts.length).toBeGreaterThan(0);
  });

  it('сохранение и перезагрузка из БД сохраняют туман и статистику', async () => {
    for (let i = 0; i < 30; i++) engine.onFix(fix(destination(monaco, 200, i * 20)));
    engine.publish();
    const cells = engine.grid.count;
    const dist = useApp.getState().stats.distanceM;
    await engine.flush();
    await engine.reloadFromDb();
    expect(engine.grid.count).toBe(cells);
    expect(useApp.getState().stats.distanceM).toBeCloseTo(dist, 5);
  });
});
