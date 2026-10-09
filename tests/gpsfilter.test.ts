import { describe, expect, it } from 'vitest';
import { GOOD_ACCURACY, GpsFilter, HOPELESS_ACCURACY } from '../src/core/gpsfilter';
import { destination, haversine } from '../src/core/geo';

const base = { lng: 7.4246, lat: 43.7384 };

/** Детерминированный «шум» (ГПСЧ), чтобы тест не мигал. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('сглаживание GPS', () => {
  it('точные фиксы проходят без изменений и без запаздывания', () => {
    const f = new GpsFilter();
    for (let i = 0; i < 5; i++) {
      const p = destination(base, 90, i * 7);
      const r = f.update({ ...p, accuracy: 6, t: 1000 + i * 5000 });
      expect(r.lng).toBe(p.lng);
      expect(r.lat).toBe(p.lat);
      expect(r.accuracy).toBe(6);
    }
    expect(GOOD_ACCURACY).toBeGreaterThanOrEqual(6);
  });

  it('фикс без указанной точности проходит как есть', () => {
    const f = new GpsFilter();
    const r = f.update({ ...base, t: 1 });
    expect(r).toMatchObject({ lng: base.lng, lat: base.lat });
  });

  it('несколько слабых фиксов на месте усредняются: ошибка положения и оценка точности падают', () => {
    const f = new GpsFilter();
    const rand = rng(7);
    let last = { lng: 0, lat: 0, accuracy: 0 };
    let worstRaw = 0;
    for (let i = 0; i < 12; i++) {
      // шум ±90 м вокруг истинной точки
      const noisy = destination(base, rand() * 360, rand() * 90);
      worstRaw = Math.max(worstRaw, haversine(base, noisy));
      last = f.update({ ...noisy, accuracy: 110, t: 1000 + i * 2000 });
    }
    expect(haversine(base, last)).toBeLessThan(worstRaw);
    expect(haversine(base, last)).toBeLessThan(55);
    expect(last.accuracy).toBeLessThan(110);
    // но оценка не обещает лучше половины погрешности одного фикса
    expect(last.accuracy).toBeGreaterThanOrEqual(55);
  });

  it('слишком грубые фиксы (по сети) не влияют на оценку', () => {
    const f = new GpsFilter();
    f.update({ ...base, accuracy: 40, t: 1000 });
    const far = destination(base, 0, 3000);
    const r = f.update({ ...far, accuracy: HOPELESS_ACCURACY + 1, t: 3000 });
    expect(r.accuracy).toBe(HOPELESS_ACCURACY + 1);
    const next = f.update({ ...base, accuracy: 40, t: 5000 });
    expect(haversine(base, next)).toBeLessThan(10);
  });

  it('после долгой паузы оценка начинается заново', () => {
    const f = new GpsFilter();
    f.update({ ...base, accuracy: 60, t: 1000 });
    const moved = destination(base, 0, 800);
    const r = f.update({ ...moved, accuracy: 60, t: 1000 + 10 * 60_000 });
    expect(haversine(moved, r)).toBeLessThan(1);
  });

  it('при движении оценка следует за человеком, а не залипает на старом месте', () => {
    const f = new GpsFilter();
    let p = base;
    let r = { lng: 0, lat: 0, accuracy: 0 };
    for (let i = 0; i < 20; i++) {
      p = destination(p, 90, 7); // ≈ 1,4 м/с при шаге 5 с
      r = f.update({ ...p, accuracy: 45, speed: 1.4, t: 1000 + i * 5000 });
    }
    expect(haversine(p, r)).toBeLessThan(32);
  });

  it('настоящий скачок (перелёт, возврат сигнала) принимается как есть, а не размазывается', () => {
    const f = new GpsFilter();
    f.update({ ...base, accuracy: 60, t: 1000 });
    f.update({ ...base, accuracy: 60, t: 3000 });
    const far = destination(base, 45, 5000);
    const r = f.update({ ...far, accuracy: 60, t: 33_000 });
    expect(haversine(far, r)).toBeLessThan(1);
    expect(r.accuracy).toBe(60);
  });

  it('обычный выброс в пределах погрешности сглаживается', () => {
    const f = new GpsFilter();
    for (let i = 0; i < 4; i++) f.update({ ...base, accuracy: 80, t: 1000 + i * 2000 });
    const off = destination(base, 90, 90);
    const r = f.update({ ...off, accuracy: 80, t: 9000 });
    expect(haversine(base, r)).toBeLessThan(60);
  });
});
