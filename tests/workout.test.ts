import { describe, expect, it } from 'vitest';
import { WorkoutTracker, convexHull, formatDuration, formatPace, metFor, polygonAreaM2, type WorkoutFix } from '../src/core/workout';
import { destination, haversine } from '../src/core/geo';

const start = { lng: 7.4246, lat: 43.7384 };
const T0 = Date.UTC(2026, 8, 28, 7, 0, 0);

/** Бежим на восток со скоростью v м/с, фикс раз в секунду. */
function run(tr: WorkoutTracker, from: { lng: number; lat: number }, seconds: number, v: number, t0: number, bearing = 90, extra: Partial<WorkoutFix> = {}) {
  let p = from;
  for (let i = 1; i <= seconds; i++) {
    p = destination(from, bearing, v * i);
    tr.addFix({ ...p, t: t0 + i * 1000, accuracy: 6, ...extra });
  }
  return p;
}

describe('workout tracker', () => {
  it('бег 3 м/с × 700 с: дистанция, темп, сплиты, калории', () => {
    const tr = new WorkoutTracker('run', 70, T0);
    tr.addFix({ ...start, t: T0, accuracy: 5 });
    run(tr, start, 700, 3, T0);
    const s = tr.live(T0 + 700_000);
    expect(s.distanceM).toBeGreaterThan(2080);
    expect(s.distanceM).toBeLessThan(2120);
    expect(s.splits).toHaveLength(2);
    expect(s.splits[0].paceS).toBeCloseTo(333.3, 0); // 1 км за 5:33
    expect(s.avgPaceS!).toBeCloseTo(333.3, 0);
    expect(s.currentPaceS!).toBeCloseTo(333.3, 0);
    expect(s.speed).toBeCloseTo(3, 1);
    // 10.8 км/ч → MET ≈ 10.6; 70 кг × 0.194 ч ≈ 144 ккал
    expect(s.calories).toBeGreaterThan(130);
    expect(s.calories).toBeLessThan(160);
    // полоса охвата ≈ 2.1 км × 50 м ≈ 0.1 км²
    expect(s.corridorM2).toBeGreaterThan(70000);
    expect(s.corridorM2).toBeLessThan(150000);
  });

  it('пауза не идёт в чистое время и не рисует линию через паузу', () => {
    const tr = new WorkoutTracker('walk', 70, T0);
    tr.addFix({ ...start, t: T0, accuracy: 5 });
    const mid = run(tr, start, 100, 1.4, T0);
    tr.pause(T0 + 100_000);
    expect(tr.state).toBe('paused');
    expect(tr.addFix({ ...destination(mid, 90, 500), t: T0 + 300_000, accuracy: 5 })).toBe(false);
    tr.resume(T0 + 400_000);
    const far = destination(mid, 90, 500);
    tr.addFix({ ...far, t: T0 + 401_000, accuracy: 5 }); // первый фикс после паузы — новый «якорь»
    tr.addFix({ ...destination(far, 90, 1.4), t: T0 + 402_000, accuracy: 5 });
    const s = tr.live(T0 + 402_000);
    expect(s.elapsedS).toBeCloseTo(102, 0); // 100 с до паузы + 2 с после
    expect(s.distanceM).toBeLessThan(160); // 500 м «телепорта» не засчитаны
  });

  it('отбрасывает плохую точность, дрожание и скачки GPS', () => {
    const tr = new WorkoutTracker('run', 70, T0);
    expect(tr.addFix({ ...start, t: T0, accuracy: 80 })).toBe(false);
    tr.addFix({ ...start, t: T0 + 1000, accuracy: 5 });
    expect(tr.addFix({ ...destination(start, 10, 1), t: T0 + 2000, accuracy: 5 })).toBe(false); // < 2 м
    expect(tr.addFix({ ...destination(start, 10, 400), t: T0 + 4000, accuracy: 5 })).toBe(false); // 100 м/с
    expect(tr.live(T0 + 5000).distanceM).toBe(0);
  });

  it('после серии «прыжков» якорь переносится: далёкая точка не засчитывается как пробег', () => {
    const tr = new WorkoutTracker('run', 70, T0);
    tr.addFix({ ...start, t: T0, accuracy: 5 });
    run(tr, start, 30, 3, T0);
    const before = tr.live(T0 + 30_000).distanceM;
    const far = destination(start, 45, 5000);
    for (let i = 1; i <= 120; i++) tr.addFix({ ...destination(far, 90, i * 3), t: T0 + 30_000 + i * 2500, accuracy: 5 });
    const after = tr.live(T0 + 400_000).distanceM;
    // засчитан только бег вокруг новой точки (≈ 117 фиксов × 3 м), но не 5 км «перелёта»
    expect(after - before).toBeGreaterThan(300);
    expect(after - before).toBeLessThan(400);
  });

  it('ходьба и бег дают разные калории на одной дистанции', () => {
    const walk = new WorkoutTracker('walk', 70, T0);
    const runr = new WorkoutTracker('run', 70, T0);
    for (const tr of [walk, runr]) {
      tr.addFix({ ...start, t: T0, accuracy: 5 });
    }
    run(walk, start, 1000, 1.4, T0);
    run(runr, start, 420, 3.33, T0);
    const w = walk.live(T0 + 1000_000);
    const r = runr.live(T0 + 420_000);
    expect(Math.abs(w.distanceM - r.distanceM)).toBeLessThan(30);
    expect(r.calories).toBeGreaterThan(w.calories * 1.3); // бег ≈ 1.0 ккал/кг/км против ≈ 0.6–0.7 у ходьбы
    expect(metFor('run', 10)).toBeCloseTo(9.8, 5);
    expect(metFor('walk', 4.5)).toBeCloseTo(3.2, 5);
  });

  it('набор высоты с гистерезисом 3 м', () => {
    const tr = new WorkoutTracker('walk', 70, T0);
    let p = start;
    let i = 0;
    for (const alt of [100, 101, 100.5, 102, 103.5, 106, 110, 108, 104, 105, 108, 112]) {
      p = destination(p, 90, 5);
      tr.addFix({ ...p, t: T0 + ++i * 4000, accuracy: 5, alt, altAccuracy: 5 });
    }
    const g = tr.live(T0 + 60000).elevGainM!;
    expect(g).toBeGreaterThan(10);
    expect(g).toBeLessThan(20);
  });

  it('замкнутый маршрут — площадь петли ≈ πr²', () => {
    const tr = new WorkoutTracker('run', 70, T0);
    const R = 100;
    const center = start;
    for (let i = 0; i <= 120; i++) {
      const p = destination(center, (i / 120) * 360, R);
      tr.addFix({ ...p, t: T0 + i * 5000, accuracy: 5 }); // ~5.2 м/с
    }
    const w = tr.finish(T0 + 600_000, 'x');
    expect(w.enclosedKind).toBe('loop');
    expect(w.enclosedM2).toBeGreaterThan(Math.PI * R * R * 0.95);
    expect(w.enclosedM2).toBeLessThan(Math.PI * R * R * 1.02);
    expect(w.distanceM).toBeGreaterThan(2 * Math.PI * R * 0.97);
  });

  it('разомкнутый маршрут — выпуклая оболочка', () => {
    const tr = new WorkoutTracker('walk', 70, T0);
    tr.addFix({ ...start, t: T0, accuracy: 5 });
    let p = start;
    for (const [b, n] of [[90, 200], [0, 200]] as const) {
      const from = p;
      for (let i = 1; i <= n; i++) {
        p = destination(from, b, i * 2);
        tr.addFix({ ...p, t: T0 + (b === 90 ? i : 200 + i) * 1000, accuracy: 5 });
      }
    }
    const w = tr.finish(T0 + 400_000, 'y');
    expect(w.enclosedKind).toBe('hull');
    // прямоугольный треугольник 400×400 → 80 000 м²
    expect(w.enclosedM2).toBeGreaterThan(70000);
    expect(w.enclosedM2).toBeLessThan(90000);
  });

  it('serialize/restore сохраняет статистику', () => {
    const tr = new WorkoutTracker('run', 65, T0);
    tr.addFix({ ...start, t: T0, accuracy: 5 });
    run(tr, start, 400, 3, T0);
    const a = tr.live(T0 + 400_000);
    const b = WorkoutTracker.restore(tr.serialize()).live(T0 + 400_000);
    expect(b.distanceM).toBeCloseTo(a.distanceM, 6);
    expect(b.splits).toEqual(a.splits);
    expect(b.calories).toBeCloseTo(a.calories, 6);
    expect(b.corridorM2).toBeGreaterThan(a.corridorM2 * 0.9);
    expect(WorkoutTracker.restore(tr.serialize()).weightKg).toBe(65);
  });

  it('геометрия и форматирование', () => {
    const sq = [
      { lng: 0, lat: 0 }, { lng: 0.001, lat: 0 }, { lng: 0.001, lat: 0.001 }, { lng: 0, lat: 0.001 }, { lng: 0.0005, lat: 0.0005 },
    ];
    expect(convexHull(sq)).toHaveLength(4);
    expect(polygonAreaM2(sq.slice(0, 4))).toBeGreaterThan(12000);
    expect(haversine(sq[0], sq[1])).toBeGreaterThan(100);
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatPace(333.3)).toBe('5:33');
    expect(formatPace(359.6)).toBe('6:00');
    expect(formatPace(null)).toBe('–:––');
    expect(formatPace(300, true)).toBe('8:03');
  });
});
