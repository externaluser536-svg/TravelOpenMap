import { describe, expect, it } from 'vitest';
import { AREA_TILE_ZOOM, MAX_AREA_BYTES, MAX_PLAN_TILES, WORLD_BBOX, WORLD_MAX_ZOOM, countryAt, planArea, planTitle, tileBounds } from '../src/core/regions';
import { countTiles, estimateBytes } from '../src/core/tiles';
import { isSaved } from '../src/map/offline-areas';
import { orderSources } from '../src/map/style';

describe('страна по точке', () => {
  it('выбирает страну с наименьшей рамкой (Монако внутри рамки Франции)', () => {
    expect(countryAt(7.4246, 43.7384)?.code).toBe('MC');
    expect(countryAt(2.35, 48.85)?.code).toBe('FR');
  });
  it('в открытом океане страны нет', () => {
    expect(countryAt(-30, 0)).toBeUndefined();
  });
});

describe('сохранённые области', () => {
  const area = { id: 'MC:city', name: 'Монако', bbox: [7.4, 43.72, 7.44, 43.76] as [number, number, number, number], maxZoom: 13, dem: false, at: 0, tiles: 10, bytes: 0 };
  const coarse = { ...area, id: 'WORLD', bbox: [-180, -85, 180, 85] as [number, number, number, number], maxZoom: 5 };
  it('область покрывает точку только при достаточной детализации', () => {
    expect(isSaved([area, coarse], 7.42, 43.74)).toBe(true);
    expect(isSaved([coarse], 7.42, 43.74)).toBe(false);
    expect(isSaved([area], 2.35, 48.85)).toBe(false);
  });
});

describe('план загрузки области', () => {
  it('небольшая страна — целиком', () => {
    const p = planArea(7.4246, 43.7384, 9)!;
    expect(p.country.code).toBe('MC');
    expect(p.whole).toBe(true);
    expect(p.key).toBe('country:MC');
    expect(p.estimate).toBeLessThanOrEqual(MAX_AREA_BYTES);
    expect(p.maxZoom).toBe(11); // на дальнем приближении — «Города»
    expect(countTiles(p.bbox, 0, p.maxZoom)).toBeLessThanOrEqual(MAX_PLAN_TILES);
  });
  it('при сильном приближении берёт улицы, если помещается', () => {
    const p = planArea(7.4246, 43.7384, 13)!;
    expect(p.maxZoom).toBe(13);
  });
  it('огромная страна — область вокруг точки, точка внутри рамки', () => {
    const at = { lng: 37.62, lat: 55.75 };
    const p = planArea(at.lng, at.lat, 8)!;
    expect(p.country.code).toBe('RU');
    expect(p.whole).toBe(false);
    expect(p.key).toMatch(new RegExp(`^area:${AREA_TILE_ZOOM}/`));
    const [w, s, e, n] = p.bbox;
    expect(at.lng >= w && at.lng <= e && at.lat >= s && at.lat <= n).toBe(true);
    expect(p.estimate).toBeLessThanOrEqual(MAX_AREA_BYTES);
    expect(estimateBytes(p.bbox, 0, p.maxZoom)).toBe(p.estimate);
    expect(countTiles(p.bbox, 0, p.maxZoom)).toBeLessThanOrEqual(MAX_PLAN_TILES);
  });
  it('в океане плана нет', () => {
    expect(planArea(-30, 0, 9)).toBeNull();
  });
  it('подпись: страна целиком или страна с координатами', () => {
    const whole = planArea(7.4246, 43.7384, 9)!;
    expect(planTitle(whole, 'ru', { lng: 7.42, lat: 43.74 })).toBe('Монако');
    const area = planArea(37.62, 55.75, 8)!;
    expect(planTitle(area, 'ru', { lng: 37.62, lat: 55.75 })).toBe('Россия · 55.8° с. ш., 37.6° в. д.');
    expect(planTitle(area, 'en', { lng: -37.62, lat: -55.75 })).toBe('Russia · 55.8° S, 37.6° W');
  });
  it('границы тайла корректны', () => {
    const b = tileBounds(1, 0, 0);
    expect(b[0]).toBeCloseTo(-180);
    expect(b[2]).toBeCloseTo(0);
    expect(b[3]).toBeCloseTo(85.0511, 3);
    expect(b[1]).toBeCloseTo(0, 5);
  });
  it('обзор мира: размер помещается в лимит', () => {
    expect(estimateBytes(WORLD_BBOX, 0, WORLD_MAX_ZOOM)).toBeLessThan(20 * 1024 * 1024);
  });
});

describe('порядок карт в стиле', () => {
  const box = (w: number, s: number, e: number, n: number, maxzoom: number, id: string) => ({ id, bounds: [w, s, e, n] as [number, number, number, number], maxzoom });
  it('сначала обширные, потом детальные', () => {
    const list = orderSources([box(7, 43, 8, 44, 15, 'mc'), box(-180, -85, 180, 85, 5, 'world'), box(-10, 36, 4, 44, 11, 'es')]);
    expect(list.map((x) => x.id)).toEqual(['world', 'es', 'mc']);
  });
  it('карта, целиком лежащая в другой с той же или большей детализацией, пропускается', () => {
    const list = orderSources([box(-10, 36, 4, 44, 13, 'es'), box(-5, 40, 0, 42, 11, 'madrid-lite'), box(-5, 40, 0, 42, 15, 'madrid')]);
    expect(list.map((x) => x.id)).toEqual(['es', 'madrid']);
  });
  it('одинаковые карты не дублируются', () => {
    const list = orderSources([box(7, 43, 8, 44, 15, 'a'), box(7, 43, 8, 44, 15, 'b')]);
    expect(list).toHaveLength(1);
  });
});
