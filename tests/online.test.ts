import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });

const bytes = (n: number, fillWith = 1) => new Uint8Array(n).fill(fillWith).buffer;

describe('кэш тайлов', () => {
  let TileCache: typeof import('../src/map/tilecache').TileCache;
  beforeEach(async () => {
    ({ TileCache } = await import('../src/map/tilecache'));
  });

  it('кладёт и отдаёт тайлы, считает размер', async () => {
    const c = new TileCache(`t-${Math.random()}`, 1e6);
    await c.put('omt/1/0/0', bytes(100));
    expect(new Uint8Array((await c.get('omt/1/0/0'))!)[0]).toBe(1);
    expect(await c.get('omt/1/1/1')).toBeUndefined();
    expect(await c.has('omt/1/0/0')).toBe(true);
    const st = await c.stats();
    expect(st).toEqual({ count: 1, bytes: 100, pinnedBytes: 0 });
    await c.put('omt/1/0/0', bytes(40)); // перезапись не задваивает учёт
    expect((await c.stats()).bytes).toBe(40);
  });

  it('вытесняет самые давние незакреплённые тайлы, закреплённые остаются', async () => {
    const c = new TileCache(`t-${Math.random()}`, 1000);
    await c.put('pinned', bytes(400), true);
    for (let i = 0; i < 8; i++) {
      await c.put(`omt/5/${i}/0`, bytes(200));
      await new Promise((r) => setTimeout(r, 2)); // разные метки времени
    }
    await c.evict();
    const st = await c.stats();
    expect(st.bytes - st.pinnedBytes).toBeLessThanOrEqual(900);
    expect(await c.has('pinned')).toBe(true);
    expect(await c.has('omt/5/0/0')).toBe(false); // самый давний вытеснен
    expect(await c.has('omt/5/7/0')).toBe(true); // самый свежий остался
  });

  it('pin закрепляет лежащий тайл, unpinKeys снимает закрепление', async () => {
    const c = new TileCache(`t-${Math.random()}`, 1000);
    await c.put('a', bytes(300));
    expect(await c.pin('a')).toBe(true);
    expect(await c.pin('missing')).toBe(false);
    expect((await c.stats()).pinnedBytes).toBe(300);
    await c.unpinKeys(['a']);
    expect((await c.stats()).pinnedBytes).toBe(0);
  });

  it('clear очищает всё', async () => {
    const c = new TileCache(`t-${Math.random()}`, 1e6);
    await c.put('a', bytes(10), true);
    await c.clear();
    expect(await c.stats()).toEqual({ count: 0, bytes: 0, pinnedBytes: 0 });
  });
});

describe('онлайн-загрузка тайлов', () => {
  let online: typeof import('../src/map/online');
  let usePrefs: typeof import('../src/state/prefs').usePrefs;
  let tileCache: typeof import('../src/map/tilecache').tileCache;
  const calls: string[] = [];

  beforeEach(async () => {
    calls.length = 0;
    mem.clear();
    vi.resetModules();
    online = await import('../src/map/online');
    ({ usePrefs } = await import('../src/state/prefs'));
    ({ tileCache } = await import('../src/map/tilecache'));
    await tileCache.clear();
    usePrefs.getState().set({ onlineMaps: false });
    vi.stubGlobal('navigator', { onLine: true, language: 'ru' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(String(url));
        if (String(url).endsWith('/planet')) return new Response(JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/20260901_001001_pt/{z}/{x}/{y}.pbf'] }), { status: 200 });
        if (String(url).includes('/9/9/9.')) return new Response(null, { status: 404 });
        return new Response(bytes(64, 7), { status: 200 });
      }),
    );
  });

  it('без согласия сеть не используется вообще', async () => {
    expect(online.onlineAllowed()).toBe(false);
    expect(await online.loadTile('omt', 3, 1, 2)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('с согласием: берёт из сети, кладёт в кэш, повторный запрос идёт из кэша', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    const first = await online.loadTile('omt', 3, 1, 2);
    expect(first?.byteLength).toBe(64);
    expect(calls[0]).toBe('https://tiles.openfreemap.org/planet');
    expect(calls[1]).toBe('https://tiles.openfreemap.org/planet/20260901_001001_pt/3/1/2.pbf');
    await new Promise((r) => setTimeout(r, 20));
    const n = calls.length;
    const second = await online.loadTile('omt', 3, 1, 2);
    expect(second?.byteLength).toBe(64);
    expect(calls).toHaveLength(n); // сеть не тронута
  });

  it('офлайн: тайл из кэша отдаётся даже при выключенной сети', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    await online.loadTile('omt', 4, 2, 2);
    await new Promise((r) => setTimeout(r, 20));
    usePrefs.getState().set({ onlineMaps: false });
    const n = calls.length;
    expect((await online.loadTile('omt', 4, 2, 2))?.byteLength).toBe(64);
    expect(calls).toHaveLength(n);
  });

  it('устройство без сети: обращения к серверу нет', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    vi.stubGlobal('navigator', { onLine: false });
    expect(online.onlineAllowed()).toBe(false);
    expect(await online.loadTile('omt', 6, 1, 1)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('404 сервера — пустой тайл, запоминается и не запрашивается снова', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    const t = await online.loadTile('omt', 9, 9, 9);
    expect(t?.byteLength).toBe(0);
    await new Promise((r) => setTimeout(r, 20));
    const n = calls.length;
    await online.loadTile('omt', 9, 9, 9);
    expect(calls).toHaveLength(n);
  });

  it('рельеф берётся с AWS Terrain и кэшируется под своим слоем', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    await online.loadTile('dem', 5, 10, 11);
    expect(calls.some((u) => u === 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/5/10/11.png')).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(await tileCache.has('dem/5/10/11')).toBe(true);
    expect(await tileCache.has('omt/5/10/11')).toBe(false);
  });

  it('шаблон TileJSON запоминается на сутки', async () => {
    usePrefs.getState().set({ onlineMaps: true });
    await online.loadTile('omt', 1, 0, 0);
    await online.loadTile('omt', 1, 1, 0);
    expect(calls.filter((u) => u.endsWith('/planet'))).toHaveLength(1);
    expect(JSON.parse(mem.get('tom.omt.template')!).tpl).toContain('20260901');
  });
});

describe('сохранение областей', () => {
  it('скачивает и закрепляет тайлы, регистрирует область; повторное сохранение не качает заново', async () => {
    vi.resetModules();
    mem.clear();
    const { usePrefs } = await import('../src/state/prefs');
    const { tileCache } = await import('../src/map/tilecache');
    const areas = await import('../src/map/offline-areas');
    await tileCache.clear();
    usePrefs.getState().set({ onlineMaps: true, savedAreas: [] });
    vi.stubGlobal('navigator', { onLine: true, language: 'ru' });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(String(url));
        if (String(url).endsWith('/planet')) return new Response(JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'] }));
        return new Response(bytes(50, 3));
      }),
    );
    const job = { id: 'MC:city', name: 'Монако', bbox: [7.4, 43.72, 7.44, 43.76] as [number, number, number, number], maxZoom: 6, dem: false };
    const plan = areas.planArea(job);
    const progress: number[] = [];
    const area = await areas.saveArea(job, { onProgress: (p) => progress.push(p.done) });
    expect(area.tiles).toBe(plan.total);
    expect(urls.filter((u) => u.endsWith('.pbf'))).toHaveLength(plan.total);
    expect(progress.at(-1)).toBe(plan.total);
    expect(usePrefs.getState().savedAreas).toHaveLength(1);
    expect((await tileCache.stats()).pinnedBytes).toBe(plan.total * 50);

    const before = urls.length;
    await areas.saveArea(job); // всё уже в кэше
    expect(urls.length).toBe(before);
    expect(usePrefs.getState().savedAreas).toHaveLength(1);

    await areas.removeArea('MC:city');
    expect(usePrefs.getState().savedAreas).toHaveLength(0);
    expect((await tileCache.stats()).pinnedBytes).toBe(0);
  });

  it('недоступный сервер: ошибка network; слишком большая область — too-large', async () => {
    vi.resetModules();
    mem.clear();
    const { usePrefs } = await import('../src/state/prefs');
    const { tileCache } = await import('../src/map/tilecache');
    const areas = await import('../src/map/offline-areas');
    await tileCache.clear();
    usePrefs.getState().set({ onlineMaps: true, savedAreas: [] });
    vi.stubGlobal('navigator', { onLine: true, language: 'ru' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const small = { id: 'x', name: 'x', bbox: [7.4, 43.72, 7.5, 43.8] as [number, number, number, number], maxZoom: 8, dem: false };
    await expect(areas.saveArea(small)).rejects.toMatchObject({ code: 'network' });
    expect(usePrefs.getState().savedAreas).toHaveLength(0);
    const huge = { id: 'y', name: 'y', bbox: [-10, 35, 30, 60] as [number, number, number, number], maxZoom: 14, dem: false };
    await expect(areas.saveArea(huge)).rejects.toMatchObject({ code: 'too-large' });
  });

  it('отмена прерывает сохранение', async () => {
    vi.resetModules();
    mem.clear();
    const { usePrefs } = await import('../src/state/prefs');
    const { tileCache } = await import('../src/map/tilecache');
    const areas = await import('../src/map/offline-areas');
    await tileCache.clear();
    usePrefs.getState().set({ onlineMaps: true, savedAreas: [] });
    vi.stubGlobal('navigator', { onLine: true, language: 'ru' });
    const ctl = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/planet')) return new Response(JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/v1/{z}/{x}/{y}.pbf'] }));
        ctl.abort();
        return new Response(bytes(10));
      }),
    );
    const job = { id: 'z', name: 'z', bbox: [7.4, 43.72, 7.5, 43.8] as [number, number, number, number], maxZoom: 8, dem: false };
    await expect(areas.saveArea(job, { signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(usePrefs.getState().savedAreas).toHaveLength(0);
  });
});
