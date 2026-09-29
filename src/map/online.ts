// Онлайн-карта: векторные тайлы OpenFreeMap (схема OpenMapTiles) и рельеф AWS Terrain Tiles.
// Каждый тайл сначала ищется в локальном кэше; если его нет и сеть разрешена — скачивается и сохраняется.
// Сеть используется только после согласия пользователя (настройка «онлайн-карта»).

import { usePrefs } from '../state/prefs';
import { tileCache } from './tilecache';

/** Единственные внешние адреса, которые приложение вообще умеет запрашивать (они же — в CSP). */
export const OFM_BASE = 'https://tiles.openfreemap.org';
export const DEM_URL = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png';
export const ONLINE_HOSTS = ['tiles.openfreemap.org', 'elevation-tiles-prod.s3.amazonaws.com'] as const;

export type TileLayer = 'omt' | 'dem';

export class OnlineError extends Error {
  constructor(public code: 'offline' | 'disabled' | 'network' | 'aborted' | 'bad-tilejson') {
    super(code);
  }
}

/** Разрешена ли сеть для карты: включено в настройках и устройство не в режиме «без сети». */
export function onlineAllowed(): boolean {
  return usePrefs.getState().onlineMaps && (typeof navigator === 'undefined' || navigator.onLine !== false);
}

const TPL_KEY = 'tom.omt.template';
const TPL_TTL = 24 * 3600 * 1000;
let tplPromise: Promise<string> | null = null;

/**
 * Шаблон URL векторных тайлов: OpenFreeMap выдаёт его в TileJSON и меняет версию раз в неделю.
 * Последний найденный шаблон хранится, чтобы не запрашивать TileJSON на каждый запуск.
 */
export function vectorTemplate(signal?: AbortSignal): Promise<string> {
  if (tplPromise) return tplPromise;
  const stored = readStoredTemplate();
  if (stored && Date.now() - stored.at < TPL_TTL) return (tplPromise = Promise.resolve(stored.tpl));
  tplPromise = (async () => {
    try {
      const r = await fetch(`${OFM_BASE}/planet`, { signal });
      if (!r.ok) throw new OnlineError('network');
      const j = (await r.json()) as { tiles?: string[] };
      const tpl = j.tiles?.[0];
      if (!tpl || !/\{z\}.*\{x\}.*\{y\}/.test(tpl)) throw new OnlineError('bad-tilejson');
      try {
        localStorage.setItem(TPL_KEY, JSON.stringify({ tpl, at: Date.now() }));
      } catch {
        /* хранилище недоступно — не страшно */
      }
      return tpl;
    } catch (e) {
      tplPromise = null;
      if (stored) return stored.tpl; // устаревший шаблон лучше, чем ничего
      throw e instanceof OnlineError ? e : new OnlineError('network');
    }
  })();
  return tplPromise;
}

function readStoredTemplate(): { tpl: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(TPL_KEY) ?? 'null');
    return v && typeof v.tpl === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Только для тестов. */
export function _resetOnlineForTests(): void {
  tplPromise = null;
}

export const tileKey = (layer: TileLayer, z: number, x: number, y: number) => `${layer}/${z}/${x}/${y}`;

const fill = (tpl: string, z: number, x: number, y: number) => tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/**
 * Скачивает тайл из сети. null — тайла нет на сервере (пустая область): его считаем пустым и не повторяем.
 * Бросает OnlineError при сетевой ошибке.
 */
export async function fetchTileNetwork(layer: TileLayer, z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  if (signal?.aborted) throw new OnlineError('aborted');
  try {
    const url = layer === 'omt' ? fill(await vectorTemplate(signal), z, x, y) : fill(DEM_URL, z, x, y);
    const r = await fetch(url, { signal });
    if (r.status === 404 || r.status === 204) return null;
    if (!r.ok) throw new OnlineError('network');
    return await r.arrayBuffer();
  } catch (e) {
    if (e instanceof OnlineError) throw e;
    if ((e as Error).name === 'AbortError') throw new OnlineError('aborted');
    throw new OnlineError('network');
  }
}

/**
 * Тайл для карты: кэш → сеть (если разрешена) → пусто. Скачанное сразу кладётся в кэш.
 * Возвращает null, если тайла нет ни в кэше, ни в сети (карта покажет пустое место).
 */
export async function loadTile(layer: TileLayer, z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const key = tileKey(layer, z, x, y);
  const cached = await tileCache.get(key);
  if (cached) return cached;
  if (!onlineAllowed()) return null;
  try {
    const data = await fetchTileNetwork(layer, z, x, y, signal);
    // отсутствующий на сервере тайл запоминаем как пустой, чтобы не спрашивать его снова
    void tileCache.put(key, data ?? new ArrayBuffer(0)).catch(() => {});
    return data ?? new ArrayBuffer(0);
  } catch (e) {
    if (e instanceof OnlineError && e.code === 'aborted') throw e;
    return null;
  }
}

let registered = false;

type AddProtocol = (id: string, handler: (params: { url: string }, abortController: AbortController) => Promise<{ data: ArrayBuffer }>) => void;

/** Регистрирует схему otile:// — источник векторных тайлов стиля (addProtocol передаётся из карты: так модуль не тянет maplibre-gl). */
export function registerOnlineProtocol(addProtocol: AddProtocol): void {
  if (registered) return;
  registered = true;
  addProtocol('otile', async (params, abortController) => {
    // otile://omt/{z}/{x}/{y}
    const m = /^otile:\/\/(omt|dem)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad otile url: ${params.url}`);
    const data = await loadTile(m[1] as TileLayer, +m[2], +m[3], +m[4], abortController.signal);
    if (!data) {
      // у растрового рельефа «пустого» тайла нет — сообщаем об ошибке тайла, карта продолжит работать
      if (m[1] === 'dem') throw new Error('no-dem-tile');
      return { data: new ArrayBuffer(0) };
    }
    return { data };
  });
}
