// Арифметика тайлов Web Mercator: какие тайлы покрывают рамку, сколько их и сколько это может весить.
// Чистая логика — используется и планированием загрузок, и самой загрузкой.

export type Box = [number, number, number, number];

const MAX_LAT = 85.0511;

const lon2x = (lon: number, n: number) => ((lon + 180) / 360) * n;
const lat2y = (lat: number, n: number) => {
  const l = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * n;
};

/** Диапазон тайлов [x0..x1]×[y0..y1] на уровне z, покрывающий рамку bbox = [запад, юг, восток, север]. */
export function tileRange(bbox: Box, z: number): { x0: number; y0: number; x1: number; y1: number } {
  const n = 2 ** z;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  return { x0: clamp(lon2x(bbox[0], n)), x1: clamp(lon2x(bbox[2] - 1e-9, n)), y0: clamp(lat2y(bbox[3], n)), y1: clamp(lat2y(bbox[1] + 1e-9, n)) };
}

/** Точное число тайлов в рамке на уровнях minZ…maxZ. */
export function countTiles(bbox: Box, minZ: number, maxZ: number): number {
  let total = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(bbox, z);
    total += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  }
  return total;
}

/** Все тайлы рамки от minZ до maxZ: сначала обзорные, потом детальные. */
export function* iterTiles(bbox: Box, minZ: number, maxZ: number): Generator<{ z: number; x: number; y: number }> {
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(bbox, z);
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield { z, x, y };
  }
}

/**
 * Грубая оценка размера векторных тайлов OpenMapTiles, байт (gzip): тайл растёт с масштабом,
 * а на высоких уровнях заметная доля тайлов пуста (океан, пустыни, поля).
 */
export function estimateBytes(bbox: Box, minZ: number, maxZ: number): number {
  let bytes = 0;
  for (let z = minZ; z <= maxZ; z++) {
    const r = tileRange(bbox, z);
    const n = (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
    const avg = z <= 5 ? 5000 : z <= 8 ? 12000 : z <= 11 ? 22000 : z <= 14 ? 34000 : 40000;
    bytes += n * avg * (z >= 9 ? 0.6 : 1);
  }
  return Math.round(bytes);
}

/** Размер растрового тайла рельефа (Terrarium PNG) в среднем, байт. */
export const DEM_TILE_BYTES = 45000;

/** Координаты тайла zoom z, содержащего точку. */
export function tileOf(lng: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  return { x: Math.max(0, Math.min(n - 1, Math.floor(lon2x(lng, n)))), y: Math.max(0, Math.min(n - 1, Math.floor(lat2y(lat, n)))) };
}
