import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
vi.stubGlobal('navigator', { onLine: true, language: 'ru' });

describe('карта района, где вы находитесь', () => {
  let hereJob: typeof import('../src/state/downloads').hereJob;
  beforeEach(async () => {
    vi.resetModules();
    mem.clear();
    ({ hereJob } = await import('../src/state/downloads'));
  });

  it('в стране каталога — страна целиком или область вокруг точки, точка внутри рамки', () => {
    const at = { lng: 7.4246, lat: 43.7384 };
    const { job, key } = hereJob(at, false);
    expect(key).toBe('country:MC');
    const [w, s, e, n] = job.bbox;
    expect(at.lng >= w && at.lng <= e && at.lat >= s && at.lat <= n).toBe(true);
    expect(job.estimate).toBeGreaterThan(0);
  });

  it('вне каталога (открытое море) — квадрат вокруг точки', () => {
    const at = { lng: -30, lat: 0 };
    const { job, key } = hereJob(at, false);
    expect(key).toBe('here:0.0,-30.0');
    const [w, s, e, n] = job.bbox;
    expect(at.lng > w && at.lng < e && at.lat > s && at.lat < n).toBe(true);
    expect(job.maxZoom).toBe(13);
    expect(job.fly).toBe(false);
  });

  it('у полюса квадрат не выходит за пределы карты', () => {
    const { job } = hereJob({ lng: 10, lat: 84.9 }, false);
    expect(job.bbox[3]).toBeLessThanOrEqual(85);
    expect(job.bbox[2]).toBeLessThanOrEqual(180);
  });
});
