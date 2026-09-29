// Ручное редактирование тумана: выбор ячеек внутри круга или многоугольника.
// Пригодится, когда вы бывали в месте до установки приложения (открыть) или хотите
// закрыть лишнее (закрыть).

import { CELLS_PER_AXIS, cellKey } from './fog';
import { latToY, lngToX, metersPerUnit, type LngLat } from './geo';

/** Больше этого числа ячеек за одну правку не берём (≈ 400 км² на широте Монако). */
export const MAX_EDIT_CELLS = 600_000;

export type FogEditAction = 'open' | 'close';

export class FogEditTooLargeError extends Error {
  constructor(public cells: number) {
    super('fog-edit-too-large');
  }
}

/** Ячейки, центр которых лежит не дальше radiusM от точки. */
export function cellsInCircle(center: LngLat, radiusM: number): number[] {
  const px = lngToX(center.lng) * CELLS_PER_AXIS;
  const py = latToY(center.lat) * CELLS_PER_AXIS;
  const cellM = metersPerUnit(center.lat) / CELLS_PER_AXIS;
  const r = radiusM / cellM;
  if (Math.PI * r * r > MAX_EDIT_CELLS) throw new FogEditTooLargeError(Math.round(Math.PI * r * r));
  const out: number[] = [];
  const r2 = r * r;
  for (let x = Math.floor(px - r - 0.5); x <= Math.ceil(px + r - 0.5); x++) {
    if (x < 0 || x >= CELLS_PER_AXIS) continue;
    const dx = x + 0.5 - px;
    for (let y = Math.floor(py - r - 0.5); y <= Math.ceil(py + r - 0.5); y++) {
      if (y < 0 || y >= CELLS_PER_AXIS) continue;
      const dy = y + 0.5 - py;
      if (dx * dx + dy * dy <= r2) out.push(cellKey(x, y));
    }
  }
  return out;
}

/** Ячейки, центр которых лежит не дальше radiusM от ломаной (мазок кисти). Одна точка — просто круг. */
export function cellsInPath(points: readonly LngLat[], radiusM: number): number[] {
  if (!points.length) return [];
  const lat0 = points[0].lat;
  const cellM = metersPerUnit(lat0) / CELLS_PER_AXIS;
  const r = radiusM / cellM;
  const pts = points.map((p) => [lngToX(p.lng) * CELLS_PER_AXIS, latToY(p.lat) * CELLS_PER_AXIS] as const);
  const r2 = r * r;
  const seen = new Set<number>();
  const out: number[] = [];
  let budget = MAX_EDIT_CELLS;
  const segs = pts.length === 1 ? [[pts[0], pts[0]] as const] : pts.slice(1).map((b, i) => [pts[i], b] as const);
  for (const [a, b] of segs) {
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r - 0.5));
    const x1 = Math.min(CELLS_PER_AXIS - 1, Math.ceil(Math.max(ax, bx) + r - 0.5));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r - 0.5));
    const y1 = Math.min(CELLS_PER_AXIS - 1, Math.ceil(Math.max(ay, by) + r - 0.5));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_EDIT_CELLS * 4) throw new FogEditTooLargeError((x1 - x0 + 1) * (y1 - y0 + 1));
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        const ex = px - (ax + t * dx);
        const ey = py - (ay + t * dy);
        if (ex * ex + ey * ey > r2) continue;
        const k = cellKey(x, y);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(k);
        if (--budget < 0) throw new FogEditTooLargeError(out.length);
      }
    }
  }
  return out;
}

/** Ячейки, центр которых лежит внутри многоугольника (≥ 3 вершин). */
export function cellsInPolygon(points: readonly LngLat[]): number[] {
  if (points.length < 3) return [];
  const pts = points.map((p) => [lngToX(p.lng) * CELLS_PER_AXIS, latToY(p.lat) * CELLS_PER_AXIS] as const);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bboxCells = (maxX - minX + 1) * (maxY - minY + 1);
  if (bboxCells > MAX_EDIT_CELLS * 4) throw new FogEditTooLargeError(Math.round(bboxCells));
  const out: number[] = [];
  const n = pts.length;
  // сканирующая строка по центрам ячеек: находим пересечения рёбер с горизонталью y и заполняем чётные интервалы
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(CELLS_PER_AXIS - 1, Math.floor(maxY)); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi > cy !== yj > cy) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(CELLS_PER_AXIS - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) out.push(cellKey(x, y));
      if (out.length > MAX_EDIT_CELLS) throw new FogEditTooLargeError(out.length);
    }
  }
  return out;
}

/** Площадь многоугольника, м² (локальная плоская аппроксимация — для подписи в интерфейсе). */
export function polygonAreaM2(points: readonly LngLat[]): number {
  if (points.length < 3) return 0;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j].lng * kx) * (points[i].lat * ky) - (points[i].lng * kx) * (points[j].lat * ky);
  }
  return Math.abs(a) / 2;
}

/** Вершины окружности для рисования (lng/lat). */
export function circlePolygon(center: LngLat, radiusM: number, steps = 64): LngLat[] {
  const out: LngLat[] = [];
  const kLng = 111320 * Math.cos((center.lat * Math.PI) / 180);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    out.push({ lng: center.lng + (Math.cos(a) * radiusM) / kLng, lat: center.lat + (Math.sin(a) * radiusM) / 110574 });
  }
  return out;
}
