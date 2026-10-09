// Что за место под пальцем: из объектов векторной карты (OpenMapTiles или Protomaps) собираем название,
// категорию и несколько понятных свойств. Данные берутся только из самих тайлов — адресов, телефонов
// и часов работы в них обычно нет, поэтому показывается то, что есть.

export interface PlaceFeature {
  /** слой тайлов: poi, place, building, park, transportation_name … */
  sourceLayer: string;
  props: Record<string, unknown>;
  /** расстояние от точки нажатия до объекта в пикселях (для точек и подписей) */
  dist?: number;
}

export interface PlaceRow {
  label: string;
  value: string;
}

export interface PlaceInfo {
  lng: number;
  lat: number;
  title: string | null;
  /** «Кафе», «Парк», «Здание»… */
  category: string | null;
  icon: string;
  kind: PlaceKind;
  rows: PlaceRow[];
  /** названия объектов вокруг: «Улица …», «Парк …» */
  context: string[];
  /** нашлись ли в карте данные об этом месте */
  found: boolean;
}

export type PlaceKind = 'poi' | 'peak' | 'place' | 'building' | 'area' | 'water' | 'road' | 'none';

type Tr = (key: string) => string;
/** Как показывать длину (метры или футы — по настройке единиц). */
export type LenFmt = (m: number) => string;
const defaultLen: LenFmt = (m) => `${Math.round(m)} m`;

/** Приоритет слоёв: чем меньше, тем «точнее» объект. */
const PRIORITY: Record<string, { rank: number; kind: PlaceKind }> = {
  poi: { rank: 0, kind: 'poi' },
  pois: { rank: 0, kind: 'poi' },
  mountain_peak: { rank: 0, kind: 'peak' },
  place: { rank: 2, kind: 'place' },
  places: { rank: 2, kind: 'place' },
  building: { rank: 3, kind: 'building' },
  buildings: { rank: 3, kind: 'building' },
  park: { rank: 4, kind: 'area' },
  landuse: { rank: 4, kind: 'area' },
  landcover: { rank: 6, kind: 'area' },
  natural: { rank: 4, kind: 'area' },
  aeroway: { rank: 4, kind: 'area' },
  water: { rank: 4, kind: 'water' },
  water_name: { rank: 4, kind: 'water' },
  waterway: { rank: 5, kind: 'water' },
  transportation_name: { rank: 5, kind: 'road' },
  transportation: { rank: 6, kind: 'road' },
  roads: { rank: 5, kind: 'road' },
};

const ICONS: [RegExp, string][] = [
  [/restaurant|cafe|fast_food|bar|pub|food|bakery|ice_cream|biergarten|confectionery|butcher|cuisine/, 'utensils'],
  [/hotel|hostel|motel|guest_house|lodging|apartment|chalet|camp_site|caravan/, 'bed'],
  [/railway|station|subway|tram|bus|ferry|transit|halt|stop|aerodrome|airport|taxi/, 'train'],
  [/peak|volcano|saddle|mountain|cliff/, 'mountain'],
  [/park|garden|forest|wood|nature|playground|picnic|campsite|grass|meadow|pitch|golf|zoo/, 'trees'],
  [/museum|theatre|theater|cinema|monument|memorial|castle|ruins|attraction|gallery|artwork|place_of_worship|church|temple|mosque|synagogue|library|arts|historic|archaeological/, 'landmark'],
  [/viewpoint|information|tourism/, 'binoculars'],
  [/bicycle|bike|cycle/, 'bike'],
];

const iconFor = (words: string): string => ICONS.find(([re]) => re.test(words))?.[1] ?? 'pin';

const str = (v: unknown): string | null => {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
};

/** Название на языке интерфейса; запасные варианты — общее имя, английское, латиницей. */
export function placeName(props: Record<string, unknown>, lang: string): string | null {
  return str(props[`name:${lang}`]) ?? str(props.name) ?? str(props['name:en']) ?? str(props.name_en) ?? str(props['name:latin']) ?? str(props['name:nonlatin']);
}

const humanize = (raw: string): string => {
  const s = raw.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
};

/** Понятная подпись категории: сначала словарь (`place.c.<значение>`), иначе читаемая версия исходного значения. */
export function categoryLabel(f: PlaceFeature, t: Tr): string | null {
  const p = f.props;
  const raws = [p.subclass, p.kind_detail, p.class, p.kind].map(str).filter((v): v is string => !!v);
  for (const r of raws) {
    const key = `place.c.${r}`;
    const tr = t(key);
    if (tr !== key) return tr;
  }
  const layerKey = `place.l.${f.sourceLayer}`;
  const layer = t(layerKey);
  if (layer !== layerKey) return raws.length && PRIORITY[f.sourceLayer]?.kind === 'poi' ? humanize(raws[0]) : layer;
  return raws.length ? humanize(raws[0]) : null;
}

function rowsFor(f: PlaceFeature, t: Tr, fmtLen: LenFmt): PlaceRow[] {
  const p = f.props;
  const rows: PlaceRow[] = [];
  const add = (key: string, label: string, fmt?: (v: string) => string) => {
    const v = str(p[key]);
    if (v) rows.push({ label: t(label), value: fmt ? fmt(v) : v });
  };
  const len = (v: string) => (Number.isFinite(Number(v)) ? fmtLen(Number(v)) : v);
  add('ele', 'place.p.ele', len);
  add('height', 'place.p.height', len);
  add('render_height', 'place.p.height', len);
  add('housenumber', 'place.p.house');
  add('addr:housenumber', 'place.p.house');
  add('ref', 'place.p.ref');
  add('network', 'place.p.network');
  add('operator', 'place.p.operator');
  add('brand', 'place.p.brand');
  add('cuisine', 'place.p.cuisine');
  add('opening_hours', 'place.p.hours');
  add('phone', 'place.p.phone');
  add('website', 'place.p.website');
  add('population', 'place.p.population', (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString() : v));
  add('level', 'place.p.level');
  // один и тот же показатель из разных полей тайла показываем один раз
  return rows.filter((r, i) => rows.findIndex((x) => x.label === r.label) === i);
}

/** Объекты, нажатие на которые информации не добавляет (границы, фон). */
const IGNORED = new Set(['boundary', 'earth', 'landcover']);

/**
 * Выбирает главный объект и собирает карточку. features — всё, что отрисовано рядом с точкой нажатия.
 */
export function buildPlace(features: readonly PlaceFeature[], at: { lng: number; lat: number }, lang: string, t: Tr, fmtLen: LenFmt = defaultLen): PlaceInfo {
  const known = features
    .filter((f) => !IGNORED.has(f.sourceLayer) && PRIORITY[f.sourceLayer])
    // объекты без названия интересны только как «здание» и «вода»; безымянная дорога или участок — не место
    .filter((f) => placeName(f.props, lang) || ['building', 'buildings', 'water', 'park', 'poi', 'pois', 'mountain_peak', 'natural', 'landuse'].includes(f.sourceLayer))
    .sort((a, b) => {
      const ra = PRIORITY[a.sourceLayer].rank;
      const rb = PRIORITY[b.sourceLayer].rank;
      if (ra !== rb) return ra - rb;
      // безымянные — после именованных, ближние — раньше дальних
      const na = placeName(a.props, lang) ? 0 : 1;
      const nb = placeName(b.props, lang) ? 0 : 1;
      if (na !== nb) return na - nb;
      return (a.dist ?? 0) - (b.dist ?? 0);
    });
  const main = known[0];
  if (!main) return { ...at, title: null, category: null, icon: 'pin', kind: 'none', rows: [], context: [], found: false };
  const title = placeName(main.props, lang);
  const category = categoryLabel(main, t);
  const words = [main.props.class, main.props.subclass, main.props.kind, main.props.kind_detail, main.sourceLayer].map(str).join(' ').toLowerCase();
  const seen = new Set<string>(title ? [title] : []);
  const context: string[] = [];
  for (const f of known.slice(1)) {
    const n = placeName(f.props, lang);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const c = categoryLabel(f, t);
    context.push(c ? `${c} «${n}»` : n);
    if (context.length >= 3) break;
  }
  return {
    ...at,
    title,
    category,
    icon: iconFor(words),
    kind: PRIORITY[main.sourceLayer].kind,
    rows: rowsFor(main, t, fmtLen),
    context,
    found: true,
  };
}
