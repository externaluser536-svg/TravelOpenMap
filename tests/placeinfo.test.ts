import { describe, expect, it } from 'vitest';
import { buildPlace, categoryLabel, placeName, type PlaceFeature } from '../src/core/placeinfo';
import { ru } from '../src/i18n/ru';
import { en } from '../src/i18n/en';

const at = { lng: 7.42, lat: 43.74 };
const trFor = (d: Record<string, string>) => (k: string) => d[k] ?? k;
const tr = trFor(ru);
const f = (sourceLayer: string, props: Record<string, unknown>, dist = 0): PlaceFeature => ({ sourceLayer, props, dist });

describe('что за место', () => {
  it('название: сначала на языке интерфейса, затем общее и английское', () => {
    expect(placeName({ name: 'Boulangerie', 'name:ru': 'Булочная' }, 'ru')).toBe('Булочная');
    expect(placeName({ name: 'Boulangerie' }, 'ru')).toBe('Boulangerie');
    expect(placeName({ 'name:en': 'Bakery' }, 'ru')).toBe('Bakery');
    expect(placeName({}, 'ru')).toBeNull();
  });

  it('точка интереса важнее здания и улицы; категория переводится', () => {
    const p = buildPlace(
      [f('transportation_name', { name: 'Rue Grimaldi', class: 'minor' }), f('building', { render_height: 12 }), f('poi', { name: 'Chez Paul', class: 'shop', subclass: 'bakery' })],
      at,
      'ru',
      tr,
    );
    expect(p.found).toBe(true);
    expect(p.title).toBe('Chez Paul');
    expect(p.category).toBe('Пекарня');
    expect(p.kind).toBe('poi');
    expect(p.context).toEqual(['Улица «Rue Grimaldi»']);
  });

  it('из нескольких точек выбирается ближайшая к пальцу', () => {
    const p = buildPlace([f('poi', { name: 'Далеко', subclass: 'cafe' }, 40), f('poi', { name: 'Рядом', subclass: 'cafe' }, 5)], at, 'ru', tr);
    expect(p.title).toBe('Рядом');
    expect(p.context).toEqual(['Кафе «Далеко»']);
  });

  it('вершина показывает высоту', () => {
    const p = buildPlace([f('mountain_peak', { name: 'Tête de Chien', class: 'peak', ele: 550 })], at, 'ru', tr);
    expect(p.kind).toBe('peak');
    expect(p.category).toBe('Вершина');
    expect(p.icon).toBe('mountain');
    expect(p.rows).toEqual([{ label: 'Высота над уровнем моря', value: '550 m' }]);
    // единицы берутся у вызывающего: например, футы
    const imp = buildPlace([f('mountain_peak', { name: 'X', ele: 550 })], at, 'en', trFor(en), (m) => `${Math.round(m * 3.28084)} ft`);
    expect(imp.rows[0].value).toBe('1804 ft');
  });

  it('одинаковые показатели из разных полей показываются один раз', () => {
    const p = buildPlace([f('building', { height: 20, render_height: 20, housenumber: '5', 'addr:housenumber': '5' })], at, 'ru', tr);
    const labels = p.rows.map((r) => r.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toEqual(['Высота здания', 'Номер дома']);
  });

  it('безымянное здание — «Здание»; безымянная дорога не считается местом', () => {
    const b = buildPlace([f('building', { render_height: 9 })], at, 'en', trFor(en));
    expect(b.found).toBe(true);
    expect(b.title).toBeNull();
    expect(b.category).toBe('Building');
    expect(b.rows[0].value).toBe('9 m');
    const r = buildPlace([f('transportation', { class: 'service' })], at, 'ru', tr);
    expect(r.found).toBe(false);
    expect(r.kind).toBe('none');
  });

  it('парк, в котором стоит точка, попадает в «Здесь»', () => {
    const p = buildPlace([f('poi', { name: 'Фонтан', subclass: 'fountain' }), f('park', { name: 'Сад Сент-Мартен', class: 'park' }), f('water', { class: 'lake' })], at, 'ru', tr);
    expect(p.context).toEqual(['Парк «Сад Сент-Мартен»']);
  });

  it('пустое место и служебные слои', () => {
    expect(buildPlace([], at, 'ru', tr)).toMatchObject({ found: false, title: null, rows: [], icon: 'pin' });
    expect(buildPlace([f('boundary', { name: 'x' }), f('landcover', { class: 'grass' })], at, 'ru', tr).found).toBe(false);
  });

  it('Protomaps: kind / kind_detail', () => {
    const p = buildPlace([f('pois', { name: 'Музей', kind: 'attraction', kind_detail: 'museum' })], at, 'ru', tr);
    expect(p.category).toBe('Музей');
    expect(p.icon).toBe('landmark');
    expect(categoryLabel(f('pois', { kind: 'strange_thing' }), tr)).toBe('Strange thing');
  });

  it('словари содержат подписи всех слоёв и свойств', () => {
    for (const k of ['poi', 'place', 'building', 'park', 'water', 'transportation_name', 'mountain_peak']) {
      expect(ru[`place.l.${k}`], k).toBeTruthy();
      expect(en[`place.l.${k}`], k).toBeTruthy();
    }
    for (const k of Object.keys(ru).filter((x) => x.startsWith('place.'))) expect(en[k], k).toBeTruthy();
  });
});
