// Геодезические функции. Чистые, без зависимостей от браузера — покрыты тестами.

export interface LngLat {
  lng: number;
  lat: number;
}

export const EARTH_RADIUS = 6371008.8; // м, средний радиус
export const EQUATOR_M = 40075016.686; // длина экватора, м

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Расстояние по большому кругу (формула гаверсинуса), метры. */
export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Начальный азимут a → b, градусы 0…360 (0 = север, по часовой). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normDeg(deg(Math.atan2(y, x)));
}

/** Точка на расстоянии dist метров по азимуту brng от p. */
export function destination(p: LngLat, brng: number, dist: number): LngLat {
  const δ = dist / EARTH_RADIUS;
  const θ = rad(brng);
  const φ1 = rad(p.lat);
  const λ1 = rad(p.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lng: ((deg(λ2) + 540) % 360) - 180, lat: deg(φ2) };
}

export function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Кратчайшая разность углов b − a в диапазоне (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normDeg(b - a);
  return d > 180 ? d - 360 : d;
}

export function pathLength(points: LngLat[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += haversine(points[i - 1], points[i]);
  return sum;
}

/** Полигон-окружность (для отрисовки зон), GeoJSON-кольцо. */
export function circleRing(center: LngLat, radiusM: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destination(center, (i / steps) * 360, radiusM);
    ring.push([p.lng, p.lat]);
  }
  return ring;
}

// ---------- Web Mercator (нормализованные координаты 0…1) ----------

export function lngToX(lng: number): number {
  return (lng + 180) / 360;
}

export function latToY(lat: number): number {
  const s = Math.sin(rad(Math.max(-85.0511, Math.min(85.0511, lat))));
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

export function xToLng(x: number): number {
  return x * 360 - 180;
}

export function yToLat(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return deg(Math.atan(Math.sinh(n)));
}

/** Метров в одной единице нормализованных Mercator-координат на данной широте. */
export function metersPerUnit(lat: number): number {
  return EQUATOR_M * Math.cos(rad(lat));
}

// ---------- Азимут → сторона света ----------

const CARDINALS_RU = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const CARDINALS_EN = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export function cardinal(deg_: number, lang: 'ru' | 'en' = 'ru'): string {
  const list = lang === 'ru' ? CARDINALS_RU : CARDINALS_EN;
  return list[Math.round(normDeg(deg_) / 45) % 8];
}

// ---------- Форматирование ----------

export type Units = 'metric' | 'imperial';
export type Lang = 'ru' | 'en';

const U = {
  ru: { m: 'м', km: 'км', m2: 'м²', km2: 'км²' },
  en: { m: 'm', km: 'km', m2: 'm²', km2: 'km²' },
};

export function formatDistance(m: number, units: Units = 'metric', lang: Lang = 'ru'): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft)} ft`;
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
  }
  const u = U[lang];
  if (m < 1000) return `${Math.round(m)} ${u.m}`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(2) : km < 100 ? km.toFixed(1) : Math.round(km)} ${u.km}`;
}

export function formatArea(m2: number, units: Units = 'metric', lang: Lang = 'ru'): string {
  if (units === 'imperial') {
    const mi2 = m2 / 2589988.11;
    if (mi2 >= 0.1) return `${mi2 < 10 ? mi2.toFixed(2) : mi2.toFixed(1)} mi²`;
    return `${Math.round(m2 * 10.7639)} ft²`;
  }
  const u = U[lang];
  if (m2 < 10000) return `${Math.round(m2)} ${u.m2}`;
  const km2 = m2 / 1e6;
  return `${km2 < 10 ? km2.toFixed(2) : km2 < 100 ? km2.toFixed(1) : Math.round(km2)} ${u.km2}`;
}

export function formatCoords(p: LngLat): string {
  const ns = p.lat >= 0 ? 'N' : 'S';
  const ew = p.lng >= 0 ? 'E' : 'W';
  return `${Math.abs(p.lat).toFixed(5)}° ${ns}, ${Math.abs(p.lng).toFixed(5)}° ${ew}`;
}
