// Стиль онлайн-карты: слои схемы OpenMapTiles (OpenFreeMap) в палитре приложения,
// плюс переключаемые слои — метро, активный отдых, высоты (тени рельефа и изолинии).
// Иконки не используются (нет спрайта под эту схему): точки и подписи рисуются кругами и текстом.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { appUrl, flavorFor, type MapTheme } from './style';

export interface MapLayersState {
  subway: boolean;
  outdoors: boolean;
  elevation: boolean;
}

export interface OnlineStyleOptions {
  theme: MapTheme;
  lang: string;
  layers: MapLayersState;
  /** URL общего протокола рельефа для hillshade (из DemSource) */
  demTiles?: string;
  /** URL протокола изолиний (из DemSource.contourProtocolUrl) */
  contourTiles?: string;
  /** наибольший масштаб тайлов; выше карта растягивается (без сети — до сохранённого максимума) */
  maxZoom?: number;
}

export const OMT_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> · <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> · <a href="https://openfreemap.org" target="_blank">OpenFreeMap</a>';
export const DEM_ATTRIBUTION = 'рельеф: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank">Terrain Tiles</a>';

const SANS = ['Noto Sans Regular'];
const SANS_MEDIUM = ['Noto Sans Medium'];
const SANS_ITALIC = ['Noto Sans Italic'];

/** Цвета слоёв: отдельно для светлой и тёмной темы, чтобы линии читались на своём фоне. */
const OVERLAY = {
  light: { subway: '#c2378a', subwayCasing: '#ffffff', trail: '#9a5b1f', cycle: '#1f5fe0', peak: '#7a4b1c', camp: '#2c8a3e', contour: '#9a7b52', contourMajor: '#7a5c34', contourLabel: '#6b4f2b', halo: '#f3f1ec' },
  dark: { subway: '#ff7ac6', subwayCasing: '#151c2c', trail: '#d9a066', cycle: '#6ea2ff', peak: '#e0b07a', camp: '#63d281', contour: '#a88a63', contourMajor: '#c9a677', contourLabel: '#d8b98a', halo: '#151d30' },
} as const;

type Layer = LayerSpecification;

const cls = (...v: string[]): ExpressionSpecification => ['in', ['get', 'class'], ['literal', v]];
const sub = (...v: string[]): ExpressionSpecification => ['in', ['get', 'subclass'], ['literal', v]];
const width = (...stops: [number, number][]): ExpressionSpecification => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops.flat()] as ExpressionSpecification;

/** Подпись объекта на выбранном языке; запасной вариант — имя по умолчанию. */
export function nameExpr(lang: string): ExpressionSpecification {
  return ['coalesce', ['get', `name:${lang}`], ['get', 'name']] as ExpressionSpecification;
}

/** Название слоя схемы для проверки в тестах. */
export const OMT_SOURCE_LAYERS = ['landcover', 'landuse', 'park', 'water', 'waterway', 'aeroway', 'building', 'boundary', 'transportation', 'transportation_name', 'place', 'water_name', 'poi', 'mountain_peak'] as const;

export function buildOnlineStyle(o: OnlineStyleOptions): StyleSpecification {
  const f = flavorFor(o.theme);
  const c = OVERLAY[o.theme];
  const name = nameExpr(o.lang);
  const layers: Layer[] = [];
  const add = (l: Layer) => layers.push(l);

  add({ id: 'background', type: 'background', paint: { 'background-color': f.background } });

  add({
    id: 'landcover',
    type: 'fill',
    source: 'omt',
    'source-layer': 'landcover',
    paint: {
      'fill-color': ['match', ['get', 'class'], 'wood', f.wood_a, 'grass', f.park_b, 'farmland', f.earth, 'sand', f.sand, 'ice', f.glacier, 'wetland', f.park_a, 'rock', f.scrub_a, f.earth],
      'fill-opacity': ['match', ['get', 'class'], 'farmland', 0.4, 0.75],
    },
  });
  add({
    id: 'landuse',
    type: 'fill',
    source: 'omt',
    'source-layer': 'landuse',
    filter: cls('cemetery', 'hospital', 'school', 'college', 'university', 'industrial', 'pitch', 'playground', 'stadium', 'military', 'zoo', 'theme_park', 'quarry', 'pedestrian', 'garages'),
    paint: {
      'fill-color': [
        'match',
        ['get', 'class'],
        'cemetery', f.park_a,
        'hospital', f.hospital,
        ['school', 'college', 'university'], f.school,
        'industrial', f.industrial,
        ['pitch', 'playground', 'stadium'], f.park_b,
        'military', f.military,
        ['zoo', 'theme_park'], f.zoo,
        'pedestrian', f.pedestrian,
        f.earth,
      ] as unknown as ExpressionSpecification,
      'fill-opacity': 0.8,
    },
  });
  add({ id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': f.park_a, 'fill-opacity': 0.45 } });

  // тени рельефа — над землёй и парками, под водой и дорогами
  if (o.layers.elevation && o.demTiles) {
    add({
      id: 'hillshade',
      type: 'hillshade',
      source: 'dem',
      paint: {
        'hillshade-exaggeration': 0.5,
        'hillshade-shadow-color': o.theme === 'dark' ? '#000000' : '#3b3326',
        'hillshade-highlight-color': o.theme === 'dark' ? '#5b6a92' : '#ffffff',
        'hillshade-accent-color': o.theme === 'dark' ? '#1b2340' : '#8a7d63',
      },
    });
  }

  add({ id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': f.water } });
  add({
    id: 'waterway',
    type: 'line',
    source: 'omt',
    'source-layer': 'waterway',
    filter: cls('river', 'canal', 'stream'),
    paint: {
      'line-color': f.water,
      // интерполяция по zoom — на верхнем уровне, класс воды выбирается внутри каждой ступени
      'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, ['match', ['get', 'class'], 'river', 0.8, 'canal', 0.5, 0.2], 14, ['match', ['get', 'class'], 'river', 3, 'canal', 2, 0.8], 18, ['match', ['get', 'class'], 'river', 8, 'canal', 4, 1.6]] as unknown as ExpressionSpecification,
    },
  });
  add({ id: 'aeroway-area', type: 'fill', source: 'omt', 'source-layer': 'aeroway', minzoom: 10, filter: ['==', ['geometry-type'], 'Polygon'] as unknown as ExpressionSpecification, paint: { 'fill-color': f.aerodrome, 'fill-opacity': 0.7 } });
  add({ id: 'aeroway-line', type: 'line', source: 'omt', 'source-layer': 'aeroway', minzoom: 10, filter: cls('runway', 'taxiway'), paint: { 'line-color': f.runway, 'line-width': width([10, 1], [14, 6], [17, 24]) } });
  add({ id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': f.buildings, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0.35, 16, 0.9] } });

  add({
    id: 'boundary',
    type: 'line',
    source: 'omt',
    'source-layer': 'boundary',
    filter: ['all', ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]] as unknown as ExpressionSpecification,
    paint: { 'line-color': f.boundaries, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 10, 1.4], 'line-dasharray': [3, 2] },
    layout: { 'line-join': 'round' },
  });

  // ---- дороги: обводка, затем заливка; туннели бледнее и пунктиром
  const roadGroups: { id: string; classes: string[]; fill: string; casing: string; w: [number, number][]; minzoom: number }[] = [
    { id: 'minor-service', classes: ['service', 'track'], fill: f.minor_service, casing: f.minor_service_casing, w: [[14, 0.8], [18, 6]], minzoom: 14 },
    { id: 'minor', classes: ['minor', 'busway'], fill: f.minor_a, casing: f.minor_casing, w: [[12, 0.6], [15, 2.4], [18, 12]], minzoom: 12 },
    { id: 'tertiary', classes: ['tertiary'], fill: f.major, casing: f.major_casing_late, w: [[11, 0.8], [15, 3.4], [18, 15]], minzoom: 11 },
    { id: 'major', classes: ['primary', 'secondary'], fill: f.major, casing: f.major_casing_early, w: [[8, 0.8], [12, 2.2], [15, 4.4], [18, 18]], minzoom: 8 },
    { id: 'highway', classes: ['motorway', 'trunk'], fill: f.highway, casing: f.highway_casing_early, w: [[5, 0.6], [9, 1.8], [12, 3], [15, 6], [18, 22]], minzoom: 5 },
  ];
  for (const g of roadGroups) {
    const filter = ['all', cls(...g.classes), ['!=', ['get', 'brunnel'], 'tunnel']] as unknown as ExpressionSpecification;
    add({ id: `road-${g.id}-casing`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: g.minzoom, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': g.casing, 'line-width': width(...g.w.map(([z, v]) => [z, v + 1.2] as [number, number])) } });
    add({ id: `road-${g.id}`, type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: g.minzoom, filter, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': g.fill, 'line-width': width(...g.w) } });
    add({
      id: `road-${g.id}-tunnel`,
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: g.minzoom,
      filter: ['all', cls(...g.classes), ['==', ['get', 'brunnel'], 'tunnel']] as unknown as ExpressionSpecification,
      paint: { 'line-color': g.fill, 'line-opacity': 0.4, 'line-width': width(...g.w), 'line-dasharray': [2, 1.5] },
    });
  }
  add({
    id: 'road-path',
    type: 'line',
    source: 'omt',
    'source-layer': 'transportation',
    minzoom: 14,
    filter: cls('path'),
    paint: { 'line-color': f.other, 'line-width': width([14, 0.5], [18, 2]), 'line-dasharray': [1.5, 1.5] },
  });
  add({ id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 9, filter: ['all', cls('rail'), ['!=', ['get', 'brunnel'], 'tunnel']] as unknown as ExpressionSpecification, paint: { 'line-color': f.railway, 'line-width': width([9, 0.5], [16, 2]), 'line-opacity': 0.8 } });
  add({ id: 'ferry', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: cls('ferry'), paint: { 'line-color': f.water, 'line-width': 1.2, 'line-dasharray': [2, 2] } });
  add({ id: 'pier', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 13, filter: cls('pier'), paint: { 'line-color': f.pier, 'line-width': width([13, 1], [18, 6]) } });

  // ---- слой «Метро»
  if (o.layers.subway) {
    const sw = ['interpolate', ['linear'], ['zoom'], 8, 1, 12, 2.4, 16, 5] as unknown as ExpressionSpecification;
    const subwayFilter = ['all', cls('transit'), sub('subway', 'light_rail', 'monorail', 'funicular')] as unknown as ExpressionSpecification;
    const overground = ['all', subwayFilter, ['!=', ['get', 'brunnel'], 'tunnel']] as unknown as ExpressionSpecification;
    const tunnel = ['all', subwayFilter, ['==', ['get', 'brunnel'], 'tunnel']] as unknown as ExpressionSpecification;
    const wide = ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4.4, 16, 8] as unknown as ExpressionSpecification;
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const;
    add({ id: 'subway-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: subwayFilter, layout: round, paint: { 'line-color': c.subwayCasing, 'line-width': wide, 'line-opacity': 0.85 } });
    add({ id: 'subway-line', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: overground, layout: round, paint: { 'line-color': c.subway, 'line-width': sw } });
    // подземные участки — пунктиром
    add({ id: 'subway-tunnel', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 8, filter: tunnel, layout: { 'line-join': 'round' }, paint: { 'line-color': c.subway, 'line-width': sw, 'line-dasharray': [2, 1.2] } });
    add({ id: 'tram-line', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['all', cls('transit'), sub('tram')] as unknown as ExpressionSpecification, paint: { 'line-color': c.subway, 'line-opacity': 0.6, 'line-width': width([12, 0.8], [16, 2]) } });
  }

  // ---- слой «Активный отдых»: тропы, велодорожки, канатные дороги
  if (o.layers.outdoors) {
    add({ id: 'trail-track', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: cls('track'), layout: { 'line-cap': 'round' }, paint: { 'line-color': c.trail, 'line-opacity': 0.85, 'line-width': width([11, 0.8], [15, 2], [18, 5]) } });
    add({ id: 'trail-hike', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ['all', cls('path'), sub('path', 'footway', 'bridleway', 'steps', 'pedestrian')] as unknown as ExpressionSpecification, layout: { 'line-cap': 'round' }, paint: { 'line-color': c.trail, 'line-width': width([11, 0.9], [15, 2], [18, 4]), 'line-dasharray': [2, 1.2] } });
    add({ id: 'trail-cycle', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: ['all', cls('path'), sub('cycleway')] as unknown as ExpressionSpecification, layout: { 'line-cap': 'round' }, paint: { 'line-color': c.cycle, 'line-width': width([11, 1], [15, 2.4], [18, 5]), 'line-dasharray': [3, 1.2] } });
    add({ id: 'aerialway', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11, filter: cls('aerialway'), paint: { 'line-color': c.peak, 'line-width': 1.4, 'line-dasharray': [1, 2.5] } });
  }

  // ---- изолинии высот
  if (o.layers.elevation && o.contourTiles) {
    add({
      id: 'contour',
      type: 'line',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 9,
      paint: {
        'line-color': ['case', ['>', ['get', 'level'], 0], c.contourMajor, c.contour] as unknown as ExpressionSpecification,
        'line-opacity': 0.7,
        'line-width': ['case', ['>', ['get', 'level'], 0], 1.1, 0.5] as unknown as ExpressionSpecification,
      },
    });
    add({
      id: 'contour-label',
      type: 'symbol',
      source: 'contours',
      'source-layer': 'contours',
      minzoom: 12,
      filter: ['>', ['get', 'level'], 0] as unknown as ExpressionSpecification,
      layout: { 'symbol-placement': 'line', 'text-field': ['concat', ['to-string', ['get', 'ele']], ' м'] as unknown as ExpressionSpecification, 'text-font': SANS, 'text-size': 10, 'text-max-angle': 30 },
      paint: { 'text-color': c.contourLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.4 },
    });
  }

  // ---- подписи
  add({
    id: 'road-label',
    type: 'symbol',
    source: 'omt',
    'source-layer': 'transportation_name',
    minzoom: 13,
    filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track', 'path'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': SANS, 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13] as unknown as ExpressionSpecification, 'text-max-angle': 30 },
    paint: { 'text-color': f.roads_label_minor, 'text-halo-color': f.roads_label_minor_halo, 'text-halo-width': 1.4 },
  });
  add({
    id: 'water-label',
    type: 'symbol',
    source: 'omt',
    'source-layer': 'water_name',
    layout: { 'text-field': name, 'text-font': SANS_ITALIC, 'text-size': 12, 'text-max-width': 6 },
    paint: { 'text-color': f.ocean_label, 'text-halo-color': f.background, 'text-halo-width': 1 },
  });
  add({
    id: 'poi',
    type: 'circle',
    source: 'omt',
    'source-layer': 'poi',
    minzoom: 15,
    filter: ['<=', ['get', 'rank'], 24] as unknown as ExpressionSpecification,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 2.2, 18, 4.5] as unknown as ExpressionSpecification, 'circle-color': f.pois?.slategray ?? f.city_label, 'circle-stroke-color': f.background, 'circle-stroke-width': 1, 'circle-opacity': 0.85 },
  });
  add({
    id: 'poi-label',
    type: 'symbol',
    source: 'omt',
    'source-layer': 'poi',
    minzoom: 16,
    filter: ['<=', ['get', 'rank'], 20] as unknown as ExpressionSpecification,
    layout: { 'text-field': name, 'text-font': SANS, 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 7, 'text-optional': true },
    paint: { 'text-color': f.subplace_label, 'text-halo-color': f.subplace_label_halo, 'text-halo-width': 1.2 },
  });

  // станции метро — поверх обычных подписей
  if (o.layers.subway) {
    const stationFilter = ['all', cls('railway'), sub('subway', 'light_rail', 'monorail')] as unknown as ExpressionSpecification;
    add({ id: 'subway-station', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 11, filter: stationFilter, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 7] as unknown as ExpressionSpecification, 'circle-color': c.subwayCasing, 'circle-stroke-color': c.subway, 'circle-stroke-width': 2.2 } });
    add({
      id: 'subway-station-label',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'poi',
      minzoom: 13.5,
      filter: stationFilter,
      layout: { 'text-field': name, 'text-font': SANS_MEDIUM, 'text-size': 11.5, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 8 },
      paint: { 'text-color': c.subway, 'text-halo-color': c.halo, 'text-halo-width': 1.6 },
    });
  }

  // пики, кемпинги, места для пикников — слой «Активный отдых»
  if (o.layers.outdoors) {
    add({
      id: 'peak-dot',
      type: 'circle',
      source: 'omt',
      'source-layer': 'mountain_peak',
      minzoom: 10,
      filter: ['has', 'name'] as unknown as ExpressionSpecification,
      paint: { 'circle-radius': 3.2, 'circle-color': c.peak, 'circle-stroke-color': c.halo, 'circle-stroke-width': 1.4 },
    });
    add({
      id: 'peak',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'mountain_peak',
      minzoom: 10,
      filter: ['has', 'name'] as unknown as ExpressionSpecification,
      layout: { 'text-field': ['concat', name, ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' м'], '']] as unknown as ExpressionSpecification, 'text-font': SANS_MEDIUM, 'text-size': 11.5, 'text-offset': [0, 0.7], 'text-anchor': 'top', 'text-max-width': 8, 'text-optional': true },
      paint: { 'text-color': c.peak, 'text-halo-color': c.halo, 'text-halo-width': 1.5 },
    });
    const campFilter = ['any', cls('campsite', 'caravan_site'), sub('camp_site', 'caravan_site', 'picnic_site', 'shelter', 'alpine_hut', 'viewpoint', 'wilderness_hut', 'drinking_water', 'fountain')] as unknown as ExpressionSpecification;
    add({ id: 'outdoor-poi', type: 'circle', source: 'omt', 'source-layer': 'poi', minzoom: 13, filter: campFilter, paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 17, 6] as unknown as ExpressionSpecification, 'circle-color': c.camp, 'circle-stroke-color': c.halo, 'circle-stroke-width': 1.6 } });
    add({ id: 'outdoor-poi-label', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 15, filter: campFilter, layout: { 'text-field': name, 'text-font': SANS, 'text-size': 11, 'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 8, 'text-optional': true }, paint: { 'text-color': c.camp, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } });
  }

  const placeSize = (city: number, town: number, village: number) => ['match', ['get', 'class'], 'city', city, 'town', town, 'village', village, 10.5] as unknown as ExpressionSpecification;
  add({
    id: 'place-label',
    type: 'symbol',
    source: 'omt',
    'source-layer': 'place',
    minzoom: 4,
    filter: cls('city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet', 'island'),
    layout: {
      'text-field': name,
      'text-font': SANS_MEDIUM,
      'text-size': ['interpolate', ['linear'], ['zoom'], 4, placeSize(11, 9, 8), 12, placeSize(19, 15, 13)] as unknown as ExpressionSpecification,
      'symbol-sort-key': ['get', 'rank'] as unknown as ExpressionSpecification,
      'text-max-width': 7,
    },
    paint: { 'text-color': f.city_label, 'text-halo-color': f.city_label_halo, 'text-halo-width': 1.6 },
  });
  add({ id: 'state-label', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 4, maxzoom: 9, filter: cls('state', 'province'), layout: { 'text-field': name, 'text-font': SANS, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1, 'text-max-width': 7 }, paint: { 'text-color': f.state_label, 'text-halo-color': f.state_label_halo, 'text-halo-width': 1.2 } });
  add({ id: 'country-label', type: 'symbol', source: 'omt', 'source-layer': 'place', maxzoom: 8, filter: cls('country'), layout: { 'text-field': name, 'text-font': SANS_MEDIUM, 'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 6, 17] as unknown as ExpressionSpecification, 'text-max-width': 7, 'symbol-sort-key': ['get', 'rank'] as unknown as ExpressionSpecification }, paint: { 'text-color': f.country_label, 'text-halo-color': f.background, 'text-halo-width': 1.4 } });

  const sources: StyleSpecification['sources'] = {
    omt: { type: 'vector', tiles: ['otile://omt/{z}/{x}/{y}'], minzoom: 0, maxzoom: o.maxZoom ?? 14, attribution: OMT_ATTRIBUTION },
  };
  if (o.layers.elevation && o.demTiles) sources.dem = { type: 'raster-dem', tiles: [o.demTiles], encoding: 'terrarium', tileSize: 256, minzoom: 0, maxzoom: 12, attribution: DEM_ATTRIBUTION };
  if (o.layers.elevation && o.contourTiles) sources.contours = { type: 'vector', tiles: [o.contourTiles], minzoom: 9, maxzoom: 14 };

  return { version: 8, glyphs: appUrl('map-assets/fonts/{fontstack}/{range}.pbf'), sources, layers };
}
