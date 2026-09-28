// Подключение PMTiles к MapLibre: карта читается из локального файла
// (встроенного в приложение или импортированного пользователем) — без сети.

import { addProtocol, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import { appUrl } from './style';

const protocol = new Protocol();
let registered = false;

export function registerPmtilesProtocol(): void {
  if (registered) return;
  setWorkerUrl(workerUrl);
  addProtocol('pmtiles', protocol.tile);
  registered = true;
}

export interface MapInfo {
  id: string;
  name: string;
  /** west, south, east, north */
  bounds: [number, number, number, number];
  minzoom: number;
  maxzoom: number;
  center: [number, number];
  /** URL для источника стиля */
  tilesUrl: string;
}

const cache = new Map<string, PMTiles>();

async function describe(id: string, name: string, p: PMTiles): Promise<MapInfo> {
  const h = await p.getHeader();
  return {
    id,
    name,
    bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat],
    minzoom: h.minZoom,
    maxzoom: h.maxZoom,
    center: [h.centerLon, h.centerLat],
    tilesUrl: `pmtiles://${p.source.getKey()}`,
  };
}

/** Карта, поставляемая вместе с приложением (public/maps/<file>). */
export async function openBundledMap(id: string, name: string, file: string): Promise<MapInfo> {
  const url = appUrl(`maps/${file}`);
  let p = cache.get(id);
  if (!p) {
    p = new PMTiles(url);
    protocol.add(p);
    cache.set(id, p);
  }
  return describe(id, name, p);
}

/** Карта, импортированная пользователем (Blob из IndexedDB / выбранный файл). */
export async function openBlobMap(id: string, name: string, blob: Blob): Promise<MapInfo> {
  let p = cache.get(id);
  if (!p) {
    const file = blob instanceof File ? blob : new File([blob], `${id}.pmtiles`);
    // ключ FileSource = имя файла → делаем его уникальным, чтобы разные карты не смешивались
    const unique = new File([file], `local-${id}.pmtiles`);
    p = new PMTiles(new FileSource(unique));
    protocol.add(p);
    cache.set(id, p);
  }
  return describe(id, name, p);
}

export function forgetMap(id: string): void {
  const p = cache.get(id);
  if (p) protocol.tiles.delete(p.source.getKey());
  cache.delete(id);
}

/** Проверяет, что файл — векторный PMTiles v3 (или бросает понятную ошибку). */
export async function inspectPmtiles(blob: Blob): Promise<{ bounds: [number, number, number, number]; minzoom: number; maxzoom: number; vector: boolean }> {
  const p = new PMTiles(new FileSource(new File([blob], `inspect-${Date.now()}.pmtiles`)));
  const h = await p.getHeader(); // бросит, если это не PMTiles
  return { bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat], minzoom: h.minZoom, maxzoom: h.maxZoom, vector: h.tileType === 1 };
}
