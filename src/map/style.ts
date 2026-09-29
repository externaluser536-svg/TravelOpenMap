// Стиль офлайн-карты: векторные тайлы OSM (PMTiles) + локальные шрифты и спрайты.
// Ни один URL здесь не указывает наружу.

import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';

export type MapTheme = 'light' | 'dark';

/** Абсолютный URL ресурса приложения (нужен воркерам MapLibre). */
export function appUrl(path: string): string {
  // Собираем строкой: new URL() экранировал бы фигурные скобки шаблонов {fontstack}/{range}.
  const base = new URL('./', document.baseURI).href;
  return base + path.replace(/^\.?\//, '');
}

// Лёгкая доводка палитры Protomaps под фирменные цвета приложения.
const LIGHT_TWEAK: Partial<Flavor> = {
  background: '#e9eef2',
  earth: '#f3f1ec',
  water: '#a9d3e8',
  park_a: '#cfe8c8',
  park_b: '#bfe0b6',
  wood_a: '#bfdcb3',
  wood_b: '#b3d4a6',
  buildings: '#e3ddd3',
  pedestrian: '#eeeae2',
};

const DARK_TWEAK: Partial<Flavor> = {
  minor_a: '#4a5880',
  minor_b: '#4a5880',
  minor_casing: '#151c2c',
  minor_service: '#3b4869',
  minor_service_casing: '#151c2c',
  major: '#65749f',
  major_casing_early: '#151c2c',
  major_casing_late: '#151c2c',
  highway: '#8090bd',
  highway_casing_early: '#151c2c',
  highway_casing_late: '#151c2c',
  other: '#34405c',
  link: '#48557a',
  roads_label_minor: '#8b98b8',
  roads_label_major: '#a3b0d0',
  background: '#151d30',
  earth: '#27324f',
  water: '#175074',
  park_a: '#24483f',
  park_b: '#285246',
  wood_a: '#234a3f',
  wood_b: '#275345',
  buildings: '#36436a',
  pedestrian: '#2f3b5e',
};

export function flavorFor(theme: MapTheme): Flavor {
  return { ...namedFlavor(theme), ...(theme === 'dark' ? DARK_TWEAK : LIGHT_TWEAK) };
}

/** Достаточное для стиля описание карты-источника. */
export interface StyleSource {
  id: string;
  tilesUrl: string;
  bounds: [number, number, number, number];
  maxzoom: number;
}

type Box = [number, number, number, number];
const area = (b: Box) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inside = (a: Box, b: Box) => a[0] >= b[0] - 1e-6 && a[1] >= b[1] - 1e-6 && a[2] <= b[2] + 1e-6 && a[3] <= b[3] + 1e-6;

/**
 * Порядок отрисовки: сначала самые обширные карты (обзор мира), поверх — детальные.
 * Карта, целиком лежащая внутри другой с не меньшей детализацией, ничего не добавляет и пропускается.
 */
export function orderSources<T extends { bounds: Box; maxzoom: number }>(list: readonly T[]): T[] {
  const sorted = [...list].sort((a, b) => area(b.bounds) - area(a.bounds) || a.maxzoom - b.maxzoom);
  return sorted.filter((s, i) => !sorted.some((o, j) => j !== i && inside(s.bounds, o.bounds) && s.maxzoom <= o.maxzoom && (area(o.bounds) > area(s.bounds) || j < i)));
}

export function buildStyle(opts: { theme: MapTheme; lang: string; sources: readonly StyleSource[] }): StyleSpecification {
  const flavor = flavorFor(opts.theme);
  const sources: StyleSpecification['sources'] = {};
  const layerList: StyleSpecification['layers'] = [];
  orderSources(opts.sources).forEach((src, i) => {
    const name = `m${i}`;
    sources[name] = {
      type: 'vector',
      url: src.tilesUrl,
      ...(i === 0 ? { attribution: '© участники <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>' } : {}),
    };
    // у каждого источника свой набор слоёв; идентификаторы получают префикс, чтобы не пересекаться
    for (const l of layers(name, flavor, { lang: opts.lang }) as StyleSpecification['layers']) layerList.push({ ...l, id: `${name}-${l.id}` } as StyleSpecification['layers'][number]);
  });
  return {
    version: 8,
    glyphs: appUrl('map-assets/fonts/{fontstack}/{range}.pbf'),
    sprite: appUrl(`map-assets/sprites/${opts.theme}`),
    sources,
    layers: layerList,
  };
}
