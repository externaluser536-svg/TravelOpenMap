import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });

const plugin = vi.hoisted(() => ({
  checkPermissions: vi.fn(async () => ({ location: 'granted', coarseLocation: 'granted' })),
  requestPermissions: vi.fn(),
  watchPosition: vi.fn(),
  clearWatch: vi.fn(async () => {}),
}));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: plugin }));

describe('геолокация без сервисов Google Play', () => {
  let loc: typeof import('../src/services/location');
  let useApp: typeof import('../src/state/store').useApp;
  const webWatch = vi.fn(() => 7);
  const webClear = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    plugin.watchPosition.mockReset();
    webWatch.mockClear();
    webClear.mockClear();
    vi.stubGlobal('navigator', { language: 'ru', geolocation: { watchPosition: webWatch, clearWatch: webClear } });
    loc = await import('../src/services/location');
    ({ useApp } = await import('../src/state/store'));
  });

  it('плагин получает enableLocationFallback: true (переход на LocationManager)', async () => {
    plugin.watchPosition.mockResolvedValue('w1');
    await loc.startLocation();
    expect(plugin.watchPosition).toHaveBeenCalledWith(expect.objectContaining({ enableLocationFallback: true, enableHighAccuracy: true }), expect.any(Function));
    expect(webWatch).not.toHaveBeenCalled();
  });

  it('при ошибке плагина (не отказ в доступе) включается запасной путь через WebView', async () => {
    let cb: (p: unknown, e?: unknown) => void = () => {};
    plugin.watchPosition.mockImplementation(async (_o: unknown, c: typeof cb) => ((cb = c), 'w1'));
    await loc.startLocation();
    cb(null, { code: 2 });
    expect(webWatch).toHaveBeenCalledTimes(1);
    expect(useApp.getState().gps).not.toBe('unavailable');
    cb(null, { code: 2 });
    expect(webWatch).toHaveBeenCalledTimes(1); // повторно не запускается
    await loc.stopLocation();
    expect(webClear).toHaveBeenCalledWith(7);
  });

  it('отказ в доступе не запускает запасной путь', async () => {
    let cb: (p: unknown, e?: unknown) => void = () => {};
    plugin.watchPosition.mockImplementation(async (_o: unknown, c: typeof cb) => ((cb = c), 'w1'));
    await loc.startLocation();
    cb(null, { code: 1 });
    expect(webWatch).not.toHaveBeenCalled();
    expect(useApp.getState().gps).toBe('denied');
  });

  it('если плагин бросил исключение при старте — тоже запасной путь', async () => {
    plugin.watchPosition.mockRejectedValue(new Error('no gms'));
    await loc.startLocation();
    expect(webWatch).toHaveBeenCalledTimes(1);
  });
});
