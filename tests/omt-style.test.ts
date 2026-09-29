import { beforeAll, describe, expect, it, vi } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';

vi.stubGlobal('document', { baseURI: 'http://localhost/' });

let buildOnlineStyle: typeof import('../src/map/omt-style').buildOnlineStyle;
let OMT_SOURCE_LAYERS: typeof import('../src/map/omt-style').OMT_SOURCE_LAYERS;
let styleKey: typeof import('../src/map/mapstyle').styleKey;

beforeAll(async () => {
  ({ buildOnlineStyle, OMT_SOURCE_LAYERS } = await import('../src/map/omt-style'));
  ({ styleKey } = await import('../src/map/mapstyle'));
});

const ALL = { subway: true, outdoors: true, elevation: true };
const NONE = { subway: false, outdoors: false, elevation: false };
const dem = { demTiles: 'dem-shared://{z}/{x}/{y}', contourTiles: 'contour://{z}/{x}/{y}?x=1' };

describe('стиль онлайн-карты (OpenMapTiles)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const [label, layers] of [['без слоёв', NONE], ['все слои', ALL]] as const) {
      it(`${theme}, ${label}: стиль проходит валидацию спецификации MapLibre`, () => {
        const style = buildOnlineStyle({ theme, lang: 'ru', layers, ...dem });
        const errors = validateStyleMin(style as never);
        expect(errors.map((e) => e.message)).toEqual([]);
      });
    }
  }

  it('слои ссылаются только на существующие слои схемы и на объявленные источники', () => {
    const style = buildOnlineStyle({ theme: 'dark', lang: 'en', layers: ALL, ...dem });
    for (const l of style.layers) {
      if (l.type === 'background') continue;
      expect(Object.keys(style.sources), l.id).toContain((l as { source: string }).source);
      const sl = (l as { 'source-layer'?: string })['source-layer'];
      if ((l as { source: string }).source === 'omt') expect(OMT_SOURCE_LAYERS as readonly string[], l.id).toContain(sl);
      if ((l as { source: string }).source === 'contours') expect(sl).toBe('contours');
    }
    const ids = style.layers.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length); // идентификаторы уникальны
  });

  it('базовый стиль работает без слоёв и не содержит рельефа и метро', () => {
    const ids = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: NONE }).layers.map((l) => l.id);
    for (const gone of ['hillshade', 'contour', 'subway-line', 'trail-hike', 'peak']) expect(ids).not.toContain(gone);
    expect(ids).toContain('road-highway');
    expect(ids).toContain('place-label');
  });

  it('слой «Метро» добавляет линии, тоннели и станции', () => {
    const ids = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: { ...NONE, subway: true } }).layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['subway-casing', 'subway-line', 'subway-tunnel', 'subway-station', 'subway-station-label']));
  });

  it('слой «Активный отдых» добавляет тропы, велодорожки, вершины и кемпинги', () => {
    const ids = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: { ...NONE, outdoors: true } }).layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['trail-hike', 'trail-cycle', 'trail-track', 'aerialway', 'peak', 'outdoor-poi']));
  });

  it('слой «Высоты» добавляет тени, изолинии и источники рельефа', () => {
    const style = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: { ...NONE, elevation: true }, ...dem });
    const ids = style.layers.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(['hillshade', 'contour', 'contour-label']));
    expect(style.sources.dem).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' });
    expect(style.sources.contours).toMatchObject({ type: 'vector' });
    // тени лежат под водой и дорогами, изолинии — над дорогами
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('water'));
    expect(ids.indexOf('contour')).toBeGreaterThan(ids.indexOf('road-highway'));
  });

  it('без рельефа от DemSource слой «Высоты» тихо пропускается', () => {
    const ids = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: { ...NONE, elevation: true } }).layers.map((l) => l.id);
    expect(ids).not.toContain('hillshade');
  });

  it('тайлы идут через протокол otile:// (кэш → сеть)', () => {
    const src = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: NONE }).sources.omt as { tiles: string[]; maxzoom: number };
    expect(src.tiles).toEqual(['otile://omt/{z}/{x}/{y}']);
    expect(src.maxzoom).toBe(14);
  });

  it('язык подписей: сначала name:<язык>, затем name', () => {
    const style = buildOnlineStyle({ theme: 'light', lang: 'ru', layers: NONE });
    const label = style.layers.find((l) => l.id === 'place-label') as { layout: { 'text-field': unknown } };
    expect(JSON.stringify(label.layout['text-field'])).toContain('name:ru');
  });

  it('ключ стиля меняется при смене режима, темы, языка и слоёв', () => {
    const base = { theme: 'dark' as const, lang: 'ru', online: true, layers: NONE, sources: [] };
    const k = styleKey(base);
    expect(styleKey({ ...base, layers: { ...NONE, subway: true } })).not.toBe(k);
    expect(styleKey({ ...base, theme: 'light' })).not.toBe(k);
    expect(styleKey({ ...base, lang: 'en' })).not.toBe(k);
    expect(styleKey({ ...base, online: false })).not.toBe(k);
    expect(styleKey({ ...base })).toBe(k);
  });
});
