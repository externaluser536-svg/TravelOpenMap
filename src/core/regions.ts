// Какую карту предложить скачать: обзор мира и область, к которой пользователь приблизился.
// Чистая логика — без сети и DOM.

import { COUNTRIES, DETAIL_PRESETS, countryName, type Country, type DetailId } from '../data/countries';
import { countTiles, estimateBytes, tileOf, type Box } from './tiles';
import { xToLng, yToLat, type Lang } from './geo';

export type { Box };

/** Обзорная карта мира: все страны и крупные города, без улиц. */
export const WORLD_BBOX: Box = [-180, -85.0511, 180, 85.0511];
export const WORLD_MAX_ZOOM = 5;
/** Больше тайлов за одну загрузку не берём (совпадает с лимитом сохранения области). */
export const MAX_PLAN_TILES = 80000;

/** С этого приближения предлагаем карту области. */
export const PROMPT_MIN_ZOOM = 7;
/** Потолок размера одной загрузки, байт. */
export const MAX_AREA_BYTES = 250 * 1024 * 1024;
/** Сторона «области» для больших стран — тайл этого уровня. */
export const AREA_TILE_ZOOM = 8;

const boxArea = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
const contains = (b: Box, lng: number, lat: number) => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];

/** Страна, в рамку которой попала точка; при нескольких — с наименьшей рамкой (Монако внутри рамки Франции). */
export function countryAt(lng: number, lat: number): Country | undefined {
  let best: Country | undefined;
  for (const c of COUNTRIES) {
    if (!contains(c.bbox, lng, lat)) continue;
    if (!best || boxArea(c.bbox) < boxArea(best.bbox)) best = c;
  }
  return best;
}

/** Рамка тайла (x, y) на уровне z в градусах. */
export function tileBounds(z: number, x: number, y: number): Box {
  const n = 2 ** z;
  return [xToLng(x / n), yToLat((y + 1) / n), xToLng((x + 1) / n), yToLat(y / n)];
}

export interface AreaPlan {
  /** ключ для «не предлагать больше»: страна целиком или тайл области */
  key: string;
  country: Country;
  /** true — вся страна, false — область вокруг точки */
  whole: boolean;
  bbox: Box;
  maxZoom: number;
  detail: DetailId;
  /** оценка размера, байт */
  estimate: number;
}

const detailZoom = (d: DetailId) => DETAIL_PRESETS.find((p) => p.id === d)!.maxZoom;

/**
 * План загрузки для точки p при текущем приближении.
 * Небольшая страна — целиком; большая — область (тайл zoom 8) вокруг точки. Детализация зависит от приближения.
 */
export function planArea(lng: number, lat: number, zoom: number): AreaPlan | null {
  const country = countryAt(lng, lat);
  if (!country) return null;
  const wanted: DetailId = zoom >= 11 ? 'street' : 'city';
  const order: DetailId[] = wanted === 'street' ? ['street', 'city', 'overview'] : ['city', 'overview'];

  const { x: tx, y: ty } = tileOf(lng, lat, AREA_TILE_ZOOM);
  const tile = tileBounds(AREA_TILE_ZOOM, tx, ty);
  const fits = (b: Box, z: number) => countTiles(b, 0, z) <= MAX_PLAN_TILES;
  // Желаемая детализация важнее охвата: сначала страна целиком, потом область — на той же детализации, и лишь затем грубее.
  for (const d of order) {
    const wholeEst = estimateBytes(country.bbox, 0, detailZoom(d));
    if (wholeEst <= MAX_AREA_BYTES && fits(country.bbox, detailZoom(d))) return { key: `country:${country.code}`, country, whole: true, bbox: country.bbox, maxZoom: detailZoom(d), detail: d, estimate: wholeEst };
    const areaEst = estimateBytes(tile, 0, detailZoom(d));
    if (areaEst <= MAX_AREA_BYTES && fits(tile, detailZoom(d))) return { key: `area:${AREA_TILE_ZOOM}/${tx}/${ty}`, country, whole: false, bbox: tile, maxZoom: detailZoom(d), detail: d, estimate: areaEst };
  }
  return null;
}

/** Подпись плана для интерфейса: «Италия» или «Россия · 55.8° с. ш., 37.6° в. д.». */
export function planTitle(plan: AreaPlan, lang: Lang, at: { lng: number; lat: number }): string {
  const name = countryName(plan.country, lang);
  if (plan.whole) return name;
  const ns = at.lat >= 0 ? (lang === 'ru' ? 'с. ш.' : 'N') : lang === 'ru' ? 'ю. ш.' : 'S';
  const ew = at.lng >= 0 ? (lang === 'ru' ? 'в. д.' : 'E') : lang === 'ru' ? 'з. д.' : 'W';
  return `${name} · ${Math.abs(at.lat).toFixed(1)}° ${ns}, ${Math.abs(at.lng).toFixed(1)}° ${ew}`;
}
