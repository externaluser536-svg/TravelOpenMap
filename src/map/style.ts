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
  minor_a: '#3b4764',
  minor_b: '#3b4764',
  minor_casing: '#151c2c',
  minor_service: '#2f3a55',
  minor_service_casing: '#151c2c',
  major: '#55628a',
  major_casing_early: '#151c2c',
  major_casing_late: '#151c2c',
  highway: '#6e7ca8',
  highway_casing_early: '#151c2c',
  highway_casing_late: '#151c2c',
  other: '#34405c',
  link: '#48557a',
  roads_label_minor: '#8b98b8',
  roads_label_major: '#a3b0d0',
  background: '#131a2b',
  earth: '#1c2438',
  water: '#123a56',
  park_a: '#1b3a35',
  park_b: '#1e4139',
  wood_a: '#1b3d35',
  wood_b: '#1e433a',
  buildings: '#2a3450',
  pedestrian: '#252f49',
};

export function flavorFor(theme: MapTheme): Flavor {
  return { ...namedFlavor(theme), ...(theme === 'dark' ? DARK_TWEAK : LIGHT_TWEAK) };
}

export function buildStyle(opts: { theme: MapTheme; lang: string; tilesUrl: string }): StyleSpecification {
  return {
    version: 8,
    glyphs: appUrl('map-assets/fonts/{fontstack}/{range}.pbf'),
    sprite: appUrl(`map-assets/sprites/${opts.theme}`),
    sources: {
      osm: {
        type: 'vector',
        url: opts.tilesUrl,
        attribution: '© участники <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
      },
    },
    layers: layers('osm', flavorFor(opts.theme), { lang: opts.lang }) as StyleSpecification['layers'],
  };
}
