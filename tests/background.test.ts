import { describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isPluginAvailable: () => false },
  registerPlugin: () => ({}),
}));

import { FixReplayer, backgroundSupported, toFix } from '../src/services/background';

const fx = (t: number, lng = 7.42) => ({ lng, lat: 43.73, t });

describe('фоновая запись: проигрывание накопленных точек', () => {
  it('накопленное проигрывается по порядку времени, затем идут живые точки', async () => {
    const got: number[] = [];
    const r = new FixReplayer((f) => got.push(f.t));
    r.live(fx(500)); // пришла, пока шёл «догон»
    const n = await r.catchUp(async () => [fx(300), fx(100), fx(200)]);
    expect(got).toEqual([100, 200, 300, 500]);
    expect(n).toBe(4);
    r.live(fx(600)); // после догона — сразу
    expect(got.at(-1)).toBe(600);
  });

  it('точки из прошлого и повторы пропускаются', async () => {
    const got: number[] = [];
    const r = new FixReplayer((f) => got.push(f.t));
    await r.catchUp(async () => [fx(100), fx(200)]);
    r.live(fx(150));
    r.live(fx(200));
    r.live(fx(250));
    expect(got).toEqual([100, 200, 250]);
  });

  it('длинный трек не блокирует поток: догон отдаёт управление', async () => {
    const got: number[] = [];
    const r = new FixReplayer((f) => got.push(f.t), 50);
    const list = Array.from({ length: 500 }, (_, i) => fx(i + 1));
    let ticks = 0;
    const timer = setInterval(() => ticks++, 0);
    await r.catchUp(async () => list);
    clearInterval(timer);
    expect(got).toHaveLength(500);
    expect(ticks).toBeGreaterThan(0);
  });

  it('повторный догон (второе сворачивание) продолжает с того же места', async () => {
    const got: number[] = [];
    const r = new FixReplayer((f) => got.push(f.t));
    await r.catchUp(async () => [fx(10), fx(20)]);
    await r.catchUp(async () => [fx(30), fx(40)]);
    expect(got).toEqual([10, 20, 30, 40]);
  });

  it('преобразование точки и поддержка платформы', () => {
    expect(toFix({ lng: 1, lat: 2, t: 3, speed: 1.5 })).toMatchObject({ lng: 1, lat: 2, t: 3, speed: 1.5, heading: null });
    expect(backgroundSupported()).toBe(false); // в браузере и в тестах плагина нет
  });
});
