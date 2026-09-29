// Сетка исследованных ячеек («туман войны»).
//
// Мир разбит на квадратные ячейки на 20-м уровне Web Mercator (≈ 38 м на экваторе,
// ≈ 27 м на широте Монако). Открытие карты = пометка ячеек внутри радиуса вокруг
// позиции. Ячейки хранятся по «чанкам» 64×64, чтобы быстро отдавать только видимые
// и сохранять в БД только изменённые части.

import { lngToX, latToY, xToLng, yToLat, metersPerUnit, type LngLat } from './geo';

export const CELL_ZOOM = 20;
export const CELLS_PER_AXIS = 2 ** CELL_ZOOM;
const CHUNK_BITS = 6;
const CHUNK_SIZE = 1 << CHUNK_BITS; // 64
const CHUNK_MASK = CHUNK_SIZE - 1;
const CHUNK_AXIS = 1 << (CELL_ZOOM - CHUNK_BITS); // 8192

export interface ExclusionZone {
  id: string;
  name: string;
  lng: number;
  lat: number;
  /** радиус, метры */
  radius: number;
}

/** Ячейка → ключ-число. x, y < 2^20, поэтому x * 2^20 + y безопасно помещается в double (< 2^53). */
export const cellKey = (x: number, y: number): number => x * CELLS_PER_AXIS + y;
export const keyX = (k: number): number => Math.floor(k / CELLS_PER_AXIS);
export const keyY = (k: number): number => k - keyX(k) * CELLS_PER_AXIS;

export function cellOf(p: LngLat): { x: number; y: number } {
  return {
    x: Math.min(CELLS_PER_AXIS - 1, Math.max(0, Math.floor(lngToX(p.lng) * CELLS_PER_AXIS))),
    y: Math.min(CELLS_PER_AXIS - 1, Math.max(0, Math.floor(latToY(p.lat) * CELLS_PER_AXIS))),
  };
}

export function cellCenter(x: number, y: number): LngLat {
  return { lng: xToLng((x + 0.5) / CELLS_PER_AXIS), lat: yToLat((y + 0.5) / CELLS_PER_AXIS) };
}

/** Сторона ячейки в метрах на её широте. */
export function cellSizeMeters(y: number): number {
  const lat = yToLat((y + 0.5) / CELLS_PER_AXIS);
  return metersPerUnit(lat) / CELLS_PER_AXIS;
}

/** Площадь ячейки, м². */
export function cellArea(y: number): number {
  const s = cellSizeMeters(y);
  return s * s;
}

export function inZone(p: LngLat, z: ExclusionZone): boolean {
  // экваториальное приближение расстояния достаточно точно для зон ≤ 20 км
  const dLat = (p.lat - z.lat) * (Math.PI / 180) * 6371008.8;
  const dLng = (p.lng - z.lng) * (Math.PI / 180) * 6371008.8 * Math.cos((z.lat * Math.PI) / 180);
  return dLat * dLat + dLng * dLng <= z.radius * z.radius;
}

export function inAnyZone(p: LngLat, zones: readonly ExclusionZone[]): boolean {
  for (const z of zones) if (inZone(p, z)) return true;
  return false;
}

const chunkKeyOf = (cx: number, cy: number) => cx * CHUNK_AXIS + cy;

export class FogGrid {
  /** чанк → множество локальных индексов ((lx << 6) | ly) */
  private chunks = new Map<number, Set<number>>();
  private dirty = new Set<number>();
  private _count = 0;
  /** Версия — увеличивается при каждом изменении, чтобы рендерер знал, когда перерисовывать. */
  version = 0;

  get count(): number {
    return this._count;
  }

  has(x: number, y: number): boolean {
    const set = this.chunks.get(chunkKeyOf(x >> CHUNK_BITS, y >> CHUNK_BITS));
    return set ? set.has(((x & CHUNK_MASK) << CHUNK_BITS) | (y & CHUNK_MASK)) : false;
  }

  /** Добавляет ячейку. Возвращает true, если она была новой. */
  add(x: number, y: number): boolean {
    const ck = chunkKeyOf(x >> CHUNK_BITS, y >> CHUNK_BITS);
    let set = this.chunks.get(ck);
    if (!set) {
      set = new Set();
      this.chunks.set(ck, set);
    }
    const local = ((x & CHUNK_MASK) << CHUNK_BITS) | (y & CHUNK_MASK);
    if (set.has(local)) return false;
    set.add(local);
    this.dirty.add(ck);
    this._count++;
    this.version++;
    return true;
  }

  /** Убирает ячейку (закрывает туманом). Возвращает true, если она была открыта. */
  remove(x: number, y: number): boolean {
    const ck = chunkKeyOf(x >> CHUNK_BITS, y >> CHUNK_BITS);
    const set = this.chunks.get(ck);
    if (!set) return false;
    if (!set.delete(((x & CHUNK_MASK) << CHUNK_BITS) | (y & CHUNK_MASK))) return false;
    if (!set.size) this.chunks.delete(ck);
    this.dirty.add(ck);
    this._count--;
    this.version++;
    return true;
  }

  /**
   * Открывает все ячейки, центр которых ближе radiusM к точке p.
   * `allowed` (необязательно) отсеивает ячейки, которые нельзя открывать (исключённые зоны).
   * Возвращает список новых ячеек.
   */
  reveal(p: LngLat, radiusM: number, allowed?: (c: LngLat) => boolean): number[] {
    const px = lngToX(p.lng) * CELLS_PER_AXIS;
    const py = latToY(p.lat) * CELLS_PER_AXIS;
    const cellM = metersPerUnit(p.lat) / CELLS_PER_AXIS; // м на ячейку на этой широте
    const rCells = radiusM / cellM;
    const r2 = rCells * rCells;
    const x0 = Math.floor(px - rCells - 0.5);
    const x1 = Math.ceil(px + rCells - 0.5);
    const y0 = Math.floor(py - rCells - 0.5);
    const y1 = Math.ceil(py + rCells - 0.5);
    const fresh: number[] = [];
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= CELLS_PER_AXIS) continue;
      const dx = x + 0.5 - px;
      for (let y = y0; y <= y1; y++) {
        if (y < 0 || y >= CELLS_PER_AXIS) continue;
        const dy = y + 0.5 - py;
        if (dx * dx + dy * dy > r2) continue;
        if (this.has(x, y)) continue;
        if (allowed && !allowed(cellCenter(x, y))) continue;
        this.add(x, y);
        fresh.push(cellKey(x, y));
      }
    }
    return fresh;
  }

  /** Открывает путь между двумя точками, шагая не реже чем radius/2. */
  revealSegment(a: LngLat, b: LngLat, radiusM: number, allowed?: (c: LngLat) => boolean): number[] {
    const fresh: number[] = [];
    const dLat = (b.lat - a.lat) * 111320;
    const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    const dist = Math.hypot(dLat, dLng);
    const steps = Math.max(1, Math.ceil(dist / (radiusM / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      fresh.push(...this.reveal({ lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t }, radiusM, allowed));
    }
    return fresh;
  }

  /** Обходит открытые ячейки, чьи чанки пересекают прямоугольник [x0,x1]×[y0,y1] (в координатах ячеек). */
  forEachInRect(x0: number, y0: number, x1: number, y1: number, cb: (x: number, y: number) => void): void {
    const cx0 = Math.max(0, Math.floor(x0) >> CHUNK_BITS);
    const cx1 = Math.min(CHUNK_AXIS - 1, Math.floor(x1) >> CHUNK_BITS);
    const cy0 = Math.max(0, Math.floor(y0) >> CHUNK_BITS);
    const cy1 = Math.min(CHUNK_AXIS - 1, Math.floor(y1) >> CHUNK_BITS);
    const nChunks = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    const iterate = (ck: number, set: Set<number>) => {
      const cx = Math.floor(ck / CHUNK_AXIS);
      const cy = ck - cx * CHUNK_AXIS;
      const bx = cx << CHUNK_BITS;
      const by = cy << CHUNK_BITS;
      for (const local of set) {
        const x = bx + (local >> CHUNK_BITS);
        const y = by + (local & CHUNK_MASK);
        if (x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1) cb(x, y);
      }
    };
    if (nChunks > this.chunks.size) {
      // вьюпорт огромный — быстрее пройтись по имеющимся чанкам
      for (const [ck, set] of this.chunks) {
        const cx = Math.floor(ck / CHUNK_AXIS);
        const cy = ck - cx * CHUNK_AXIS;
        if (cx < cx0 || cx > cx1 || cy < cy0 || cy > cy1) continue;
        iterate(ck, set);
      }
    } else {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const ck = chunkKeyOf(cx, cy);
          const set = this.chunks.get(ck);
          if (set) iterate(ck, set);
        }
      }
    }
  }

  forEach(cb: (x: number, y: number) => void): void {
    for (const [ck, set] of this.chunks) {
      const cx = Math.floor(ck / CHUNK_AXIS);
      const cy = ck - cx * CHUNK_AXIS;
      for (const local of set) cb((cx << CHUNK_BITS) + (local >> CHUNK_BITS), (cy << CHUNK_BITS) + (local & CHUNK_MASK));
    }
  }

  /** Площадь, м², и число ячеек вне исключённых зон. */
  measure(zones: readonly ExclusionZone[] = []): { cells: number; areaM2: number } {
    let cells = 0;
    let areaM2 = 0;
    // кэш площади по строке y: ячейки в одной строке имеют одинаковую площадь
    const areaByY = new Map<number, number>();
    this.forEach((x, y) => {
      if (zones.length && inAnyZone(cellCenter(x, y), zones)) return;
      let a = areaByY.get(y);
      if (a === undefined) {
        a = cellArea(y);
        areaByY.set(y, a);
      }
      cells++;
      areaM2 += a;
    });
    return { cells, areaM2 };
  }

  /** Границы открытой области (lng/lat) или null, если ничего не открыто. */
  bounds(): { west: number; south: number; east: number; north: number } | null {
    if (!this._count) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    this.forEach((x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
    return {
      west: xToLng(minX / CELLS_PER_AXIS),
      east: xToLng((maxX + 1) / CELLS_PER_AXIS),
      north: yToLat(minY / CELLS_PER_AXIS),
      south: yToLat((maxY + 1) / CELLS_PER_AXIS),
    };
  }

  // ---------- Сохранение ----------

  /** Забирает изменённые чанки для записи в БД и сбрасывает флаг «грязных». */
  takeDirty(): { key: number; cells: Uint16Array }[] {
    const out: { key: number; cells: Uint16Array }[] = [];
    for (const ck of this.dirty) {
      const set = this.chunks.get(ck);
      // чанк, опустевший после закрытия, записываем пустым — в БД остаётся актуальное состояние
      out.push({ key: ck, cells: set ? Uint16Array.from(set) : new Uint16Array(0) });
    }
    this.dirty.clear();
    return out;
  }

  loadChunk(key: number, cells: ArrayLike<number>): void {
    let set = this.chunks.get(key);
    if (!set) {
      set = new Set();
      this.chunks.set(key, set);
    }
    for (let i = 0; i < cells.length; i++) {
      if (!set.has(cells[i])) {
        set.add(cells[i]);
        this._count++;
      }
    }
    this.version++;
  }

  clear(): void {
    this.chunks.clear();
    this.dirty.clear();
    this._count = 0;
    this.version++;
  }

  /** Все чанки целиком (для экспорта резервной копии). */
  allChunks(): { key: number; cells: number[] }[] {
    return [...this.chunks].map(([key, set]) => ({ key, cells: [...set] }));
  }
}
