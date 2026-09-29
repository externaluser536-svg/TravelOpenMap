// Извлечение региона из большого (в том числе удалённого) PMTiles.
//
// Читает по HTTP Range только каталоги и тайлы, попадающие в рамку bbox на нужных уровнях
// масштаба, и собирает из них компактный локальный файл — то же, что делает `pmtiles extract`.

import { Compression, PMTiles, TileType } from 'pmtiles';
import { gzip, writePmtiles, type WriterTile } from './pmtiles-writer';

export interface ExtractSource {
  getHeader: PMTiles['getHeader'];
  getMetadata: PMTiles['getMetadata'];
  getZxy: PMTiles['getZxy'];
}

export interface ExtractOptions {
  bbox: [number, number, number, number]; // west, south, east, north
  minZoom?: number;
  maxZoom: number;
  name: string;
  /** лимит суммарного размера тайлов в памяти, байт */
  maxBytes?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (p: { done: number; total: number; bytes: number; zoom: number }) => void;
}

export class ExtractTooLargeError extends Error {
  constructor(public bytes: number) {
    super('too-large');
  }
}

/** Диапазон тайлов [x0..x1]×[y0..y1] на уровне z, покрывающий bbox. */
export function tileRange(bbox: [number, number, number, number], z: number): { x0: number; y0: number; x1: number; y1: number } {
  const n = 2 ** z;
  const lon2x = (lon: number) => ((lon + 180) / 360) * n;
  const lat2y = (lat: number) => {
    const l = Math.max(-85.0511, Math.min(85.0511, lat)) * (Math.PI / 180);
    return ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n;
  };
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  return { x0: clamp(lon2x(bbox[0])), x1: clamp(lon2x(bbox[2] - 1e-9)), y0: clamp(lat2y(bbox[3])), y1: clamp(lat2y(bbox[1] + 1e-9)) };
}

/** Точное число тайлов в рамке на уровнях minZ…maxZ. */
export function countTiles(bbox: [number, number, number, number], minZ: number, maxZ: number): number {
  let total = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(bbox, z);
    total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return total;
}

/** Грубая оценка размера, байт: средний размер векторного тайла Protomaps растёт с масштабом. */
export function estimateBytes(bbox: [number, number, number, number], minZ: number, maxZ: number): number {
  let bytes = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(bbox, z);
    const n = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    // ~ не все тайлы непусты (океан, пустыни): учитываем долей 0.6 на высоких уровнях
    const avg = z <= 5 ? 6000 : z <= 8 ? 14000 : z <= 11 ? 22000 : 26000;
    bytes += n * avg * (z >= 9 ? 0.6 : 1);
  }
  return Math.round(bytes);
}

export async function extractRegion(src: ExtractSource, o: ExtractOptions): Promise<{ blob: Blob; tiles: number; bytes: number }> {
  const header = await src.getHeader();
  if (header.tileType !== TileType.Mvt) throw new Error('not-vector');
  const meta = ((await src.getMetadata()) ?? {}) as Record<string, unknown>;
  const minZ = Math.max(o.minZoom ?? header.minZoom, header.minZoom);
  const maxZ = Math.min(o.maxZoom, header.maxZoom);
  if (maxZ < minZ) throw new Error('bad-zoom');

  const jobs: [number, number, number][] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(o.bbox, z);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push([z, x, y]);
  }
  const tiles: WriterTile[] = [];
  let bytes = 0;
  let done = 0;
  let next = 0;
  const limit = o.maxBytes ?? Infinity;
  const worker = async () => {
    while (next < jobs.length) {
      if (o.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const [z, x, y] = jobs[next++];
      const r = await src.getZxy(z, x, y, o.signal);
      done++;
      if (r) {
        // getZxy отдаёт уже распакованный тайл — сжимаем заново для компактного файла
        const data = await gzip(new Uint8Array(r.data));
        bytes += data.length;
        if (bytes > limit) throw new ExtractTooLargeError(bytes);
        tiles.push({ z, x, y, data });
      }
      if (done % 8 === 0 || done === jobs.length) o.onProgress?.({ done, total: jobs.length, bytes, zoom: z });
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 6 }, worker));

  const blob = await writePmtiles(
    tiles,
    {
      tileType: header.tileType,
      tileCompression: Compression.Gzip,
      minZoom: minZ,
      maxZoom: maxZ,
      bounds: o.bbox,
    },
    { ...meta, name: o.name, generator: 'TravelOpenMap extract', description: `Регион из ${meta.name ?? 'источника'}` },
  );
  return { blob, tiles: tiles.length, bytes };
}
