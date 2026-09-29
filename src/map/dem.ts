// Рельеф и изолинии: DEM-тайлы Terrarium читаются через тот же кэш, что и векторные тайлы,
// а изолинии строит maplibre-contour прямо на устройстве.

import mlcontour from 'maplibre-contour';
import { loadTile } from './online';
import { DEM_MAX_ZOOM } from './offline-areas';

/** Пороги изолиний, м: [обычная, отметка каждая N-я]. */
export const CONTOUR_THRESHOLDS: Record<number, [number, number]> = {
  9: [200, 1000],
  10: [100, 500],
  11: [50, 250],
  12: [20, 100],
  13: [10, 50],
  14: [5, 25],
};

const PATTERN = 'otile://dem/{z}/{x}/{y}';

export interface Dem {
  /** URL общего источника рельефа для слоя hillshade */
  sharedUrl: string;
  /** URL векторных тайлов изолиний */
  contourUrl: string;
}

let dem: Dem | null = null;
type AddProtocol = Parameters<InstanceType<typeof mlcontour.DemSource>['setupMaplibre']>[0]['addProtocol'];
let adder: AddProtocol | null = null;

/** Карта сообщает, как регистрировать протоколы (addProtocol из maplibre-gl). */
export function setProtocolAdder(fn: unknown): void {
  adder = fn as AddProtocol;
}

export function getDem(): Dem {
  if (dem) return dem;
  const source = new mlcontour.DemSource({ url: PATTERN, encoding: 'terrarium', maxzoom: DEM_MAX_ZOOM, worker: false, cacheSize: 120, timeoutMs: 20000 });
  // тайлы рельефа берём из нашего кэша/сети, а не напрямую через fetch
  source.manager = new mlcontour.LocalDemManager({
    demUrlPattern: PATTERN,
    cacheSize: 120,
    timeoutMs: 20000,
    encoding: 'terrarium',
    maxzoom: DEM_MAX_ZOOM,
    getTile: async (url, abortController) => {
      const m = /(\d+)\/(\d+)\/(\d+)$/.exec(url);
      if (!m) throw new Error(`bad dem url: ${url}`);
      const buf = await loadTile('dem', +m[1], +m[2], +m[3], abortController.signal);
      if (!buf || !buf.byteLength) throw new Error('no dem tile');
      return { data: new Blob([buf], { type: 'image/png' }) };
    },
  });
  if (!adder) throw new Error('protocol adder is not set');
  source.setupMaplibre({ addProtocol: adder });
  dem = {
    sharedUrl: source.sharedDemProtocolUrl,
    contourUrl: source.contourProtocolUrl({ thresholds: CONTOUR_THRESHOLDS, contourLayer: 'contours', elevationKey: 'ele', levelKey: 'level', extent: 4096, buffer: 1 }),
  };
  return dem;
}
