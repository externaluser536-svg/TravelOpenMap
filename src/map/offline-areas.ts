// Сохранение областей для работы без сети: тайлы заранее скачиваются и закрепляются в кэше.

import { iterTiles, countTiles, estimateBytes, DEM_TILE_BYTES, type Box } from '../core/tiles';
import { OnlineError, fetchTileNetwork, tileKey, type TileLayer } from './online';
import { tileCache } from './tilecache';
import { usePrefs, type SavedArea } from '../state/prefs';

/** Выше 14-го уровня OpenFreeMap тайлов не отдаёт — карта растягивает 14-й. */
export const OMT_MAX_ZOOM = 14;
/** Рельеф Terrarium доступен до 15-го, но для изолиний и теней достаточно 12-го. */
export const DEM_MAX_ZOOM = 12;
/** Не больше стольких тайлов за одну загрузку: и бережём чужой сервер, и место на устройстве. */
export const MAX_AREA_TILES = 80000;
const CONCURRENCY = 6;

export interface AreaJob {
  id: string;
  name: string;
  flag?: string;
  bbox: Box;
  maxZoom: number;
  /** сохранять ли рельеф */
  dem: boolean;
}

export interface AreaProgress {
  done: number;
  total: number;
  bytes: number;
  failed: number;
}

export class AreaError extends Error {
  constructor(public code: 'too-large' | 'network' | 'aborted') {
    super(code);
  }
}

/** Сколько тайлов и байт потребуется (оценка). */
export function planArea(job: Pick<AreaJob, 'bbox' | 'maxZoom' | 'dem'>): { vector: number; dem: number; total: number; estimate: number } {
  const zMax = Math.min(job.maxZoom, OMT_MAX_ZOOM);
  const vector = countTiles(job.bbox, 0, zMax);
  const dem = job.dem ? countTiles(job.bbox, 0, Math.min(zMax, DEM_MAX_ZOOM)) : 0;
  return { vector, dem, total: vector + dem, estimate: estimateBytes(job.bbox, 0, zMax) + dem * DEM_TILE_BYTES };
}

function* jobTiles(job: AreaJob): Generator<{ layer: TileLayer; z: number; x: number; y: number }> {
  const zMax = Math.min(job.maxZoom, OMT_MAX_ZOOM);
  for (const t of iterTiles(job.bbox, 0, zMax)) yield { layer: 'omt', ...t };
  if (job.dem) for (const t of iterTiles(job.bbox, 0, Math.min(zMax, DEM_MAX_ZOOM))) yield { layer: 'dem', ...t };
}

/**
 * Скачивает тайлы области и закрепляет их в кэше. Уже лежащие в кэше тайлы не скачиваются повторно.
 * Бросает AreaError: too-large, network (сервер недоступен), aborted.
 */
export async function saveArea(job: AreaJob, opts: { signal?: AbortSignal; onProgress?: (p: AreaProgress) => void } = {}): Promise<SavedArea> {
  const plan = planArea(job);
  if (plan.total > MAX_AREA_TILES) throw new AreaError('too-large');
  const it = jobTiles(job);
  const prog: AreaProgress = { done: 0, total: plan.total, bytes: 0, failed: 0 };
  let consecutive = 0;
  let fatal: AreaError | null = null;

  const worker = async () => {
    for (;;) {
      if (fatal) return;
      if (opts.signal?.aborted) {
        fatal = new AreaError('aborted');
        return;
      }
      const n = it.next();
      if (n.done) return;
      const { layer, z, x, y } = n.value;
      const key = tileKey(layer, z, x, y);
      try {
        if (await tileCache.pin(key)) {
          consecutive = 0;
        } else {
          const data = await fetchTileNetwork(layer, z, x, y, opts.signal);
          await tileCache.put(key, data ?? new ArrayBuffer(0), true);
          prog.bytes += data?.byteLength ?? 0;
          consecutive = 0;
        }
      } catch (e) {
        if (e instanceof OnlineError && e.code === 'aborted') {
          fatal = new AreaError('aborted');
          return;
        }
        prog.failed++;
        // подряд провалились десятки запросов — сервер или сеть недоступны, дальше нет смысла
        if (++consecutive >= 24) {
          fatal = new AreaError('network');
          return;
        }
      }
      prog.done++;
      opts.onProgress?.({ ...prog });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (fatal) throw fatal;
  if (prog.failed > plan.total * 0.05) throw new AreaError('network');

  const area: SavedArea = { id: job.id, name: job.name, flag: job.flag, bbox: job.bbox, maxZoom: Math.min(job.maxZoom, OMT_MAX_ZOOM), dem: job.dem, at: Date.now(), tiles: plan.total, bytes: prog.bytes };
  const prefs = usePrefs.getState();
  prefs.set({ savedAreas: [...prefs.savedAreas.filter((a) => a.id !== area.id), area] });
  return area;
}

/** Удаляет сохранённую область: её тайлы перестают быть закреплёнными и постепенно вытесняются. */
export async function removeArea(id: string): Promise<void> {
  const prefs = usePrefs.getState();
  const area = prefs.savedAreas.find((a) => a.id === id);
  if (!area) return;
  const keys: string[] = [];
  const job: AreaJob = { id: area.id, name: area.name, bbox: area.bbox, maxZoom: area.maxZoom, dem: area.dem };
  for (const t of jobTiles(job)) keys.push(tileKey(t.layer, t.z, t.x, t.y));
  await tileCache.unpinKeys(keys);
  prefs.set({ savedAreas: prefs.savedAreas.filter((a) => a.id !== id) });
}

/** Есть ли сохранённая область с достаточной детализацией вокруг точки. */
export function isSaved(areas: readonly SavedArea[], lng: number, lat: number, minZoom = 10): boolean {
  return areas.some((a) => a.maxZoom >= minZoom && lng >= a.bbox[0] && lng <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3]);
}
