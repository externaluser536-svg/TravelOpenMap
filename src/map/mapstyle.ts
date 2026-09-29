// Выбор стиля карты: онлайн (кэшируемые тайлы OpenFreeMap + слои) или офлайн-файлы PMTiles.

import type { StyleSpecification } from 'maplibre-gl';
import type { MapInfo } from './pmtiles';
import { buildStyle, type MapTheme } from './style';
import { buildOnlineStyle, type MapLayersState } from './omt-style';
import { getDem } from './dem';

export interface MapStyleState {
  theme: MapTheme;
  lang: string;
  online: boolean;
  layers: MapLayersState;
  sources: readonly MapInfo[];
  /** наибольший масштаб онлайн-тайлов (по умолчанию 14) */
  omtMaxZoom?: number;
}

export function buildMapStyle(s: MapStyleState): StyleSpecification {
  if (s.online) {
    const dem = s.layers.elevation ? getDem() : null;
    return buildOnlineStyle({ theme: s.theme, lang: s.lang, layers: s.layers, demTiles: dem?.sharedUrl, contourTiles: dem?.contourUrl, maxZoom: s.omtMaxZoom });
  }
  return buildStyle({ theme: s.theme, lang: s.lang, sources: s.sources });
}

/** Ключ, по которому MapView понимает, что стиль надо пересобрать. */
export function styleKey(s: MapStyleState): string {
  const l = s.layers;
  return s.online ? `on/${s.theme}/${s.lang}/${+l.subway}${+l.outdoors}${+l.elevation}/${s.omtMaxZoom ?? 14}` : `off/${s.theme}/${s.lang}/${s.sources.map((m) => `${m.id}:${m.maxzoom}`).join('|')}`;
}
