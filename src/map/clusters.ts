// Группировка меток на карте: при отдалении близкие метки собираются в один значок со счётчиком,
// при приближении — распадаются. Чистая логика (без DOM), поверх supercluster.

import Supercluster from 'supercluster';

export interface ClusterNote {
  id: string;
  lng: number;
  lat: number;
  category: string;
}

type CatCounts = Record<string, number>;
interface PointProps {
  id: string;
  cats: CatCounts;
}
interface ClusterProps extends PointProps {
  cluster?: true;
  cluster_id?: number;
  point_count?: number;
}

export type ClusterItem =
  | { kind: 'pin'; key: string; id: string; lng: number; lat: number }
  | { kind: 'cluster'; key: string; clusterId: number; count: number; lng: number; lat: number; cats: CatCounts };

/** Радиус группировки в пикселях экрана: метки ближе этого расстояния сливаются. */
export const CLUSTER_RADIUS = 46;
/** Максимальный zoom, на котором ещё группируем (выше — только совпадающие практически в одной точке). */
export const CLUSTER_MAX_ZOOM = 20;

export class NoteClusters {
  private index: Supercluster<PointProps, PointProps>;

  constructor(notes: readonly ClusterNote[]) {
    this.index = new Supercluster<PointProps, PointProps>({
      radius: CLUSTER_RADIUS,
      maxZoom: CLUSTER_MAX_ZOOM,
      minZoom: 0,
      map: (p) => ({ id: p.id, cats: { ...p.cats } }),
      reduce: (acc, p) => {
        // supercluster клонирует свойства неглубоко — вложенный объект копируем сами, иначе исказим нижние уровни
        acc.cats = { ...acc.cats };
        for (const [k, v] of Object.entries(p.cats)) acc.cats[k] = (acc.cats[k] ?? 0) + v;
      },
    });
    this.index.load(
      notes.map((n) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [n.lng, n.lat] },
        properties: { id: n.id, cats: { [n.category]: 1 } },
      })),
    );
  }

  /** Значки для видимой области: bbox = [запад, юг, восток, север]. */
  view(bbox: [number, number, number, number], zoom: number): ClusterItem[] {
    const z = Math.max(0, Math.min(CLUSTER_MAX_ZOOM + 1, Math.floor(zoom)));
    const out: ClusterItem[] = [];
    const parts: [number, number, number, number][] =
      bbox[0] <= bbox[2] ? [bbox] : [[bbox[0], bbox[1], 180, bbox[3]], [-180, bbox[1], bbox[2], bbox[3]]];
    for (const b of parts) {
      for (const f of this.index.getClusters(b, z) as unknown as { geometry: { coordinates: number[] }; properties: ClusterProps }[]) {
        const [lng, lat] = f.geometry.coordinates;
        const p = f.properties;
        if (p.cluster && p.cluster_id !== undefined) {
          out.push({ kind: 'cluster', key: `c${p.cluster_id}`, clusterId: p.cluster_id, count: p.point_count ?? 0, lng, lat, cats: p.cats });
        } else {
          out.push({ kind: 'pin', key: `p${p.id}`, id: p.id, lng, lat });
        }
      }
    }
    return out;
  }

  /** Zoom, при котором эта группа впервые распадается. */
  expansionZoom(clusterId: number): number {
    return this.index.getClusterExpansionZoom(clusterId);
  }

  /** id всех заметок группы. */
  leaves(clusterId: number): string[] {
    return this.index.getLeaves(clusterId, Infinity).map((f) => (f.properties as PointProps).id);
  }
}

/** conic-gradient по долям категорий (для кольца вокруг счётчика). */
export function categoryRing(cats: CatCounts, colorOf: (id: string) => string): string {
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  let acc = 0;
  const stops: string[] = [];
  for (const [id, v] of entries) {
    const from = (acc / total) * 100;
    acc += v;
    const to = (acc / total) * 100;
    stops.push(`${colorOf(id)} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
  }
  return `conic-gradient(${stops.join(', ')})`;
}
