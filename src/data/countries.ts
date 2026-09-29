// Каталог стран: названия ru/en, флаг, регион, валюта, рамка основной территории.
// Генерируется tools/build-countries.mjs из пакета world-countries.

import raw from './countries.json';
import type { Lang } from '../core/geo';

export interface Country {
  code: string;
  ru: string;
  en: string;
  flag: string;
  region: string;
  sub: string;
  cur: string;
  /** км² */
  area: number;
  lat: number;
  lng: number;
  /** west, south, east, north */
  bbox: [number, number, number, number];
}

export const COUNTRIES = raw as Country[];

export const REGIONS = ['Europe', 'Asia', 'Africa', 'Americas', 'Oceania'] as const;

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));
export const countryByCode = (code: string): Country | undefined => byCode.get(code);

export const countryName = (c: Country, lang: Lang): string => (lang === 'ru' ? c.ru : c.en);

export function searchCountries(q: string, lang: Lang, region: string | null): Country[] {
  const s = q.trim().toLowerCase();
  const list = COUNTRIES.filter((c) => (!region || c.region === region) && (!s || c.ru.toLowerCase().includes(s) || c.en.toLowerCase().includes(s) || c.code.toLowerCase() === s));
  return [...list].sort((a, b) => countryName(a, lang).localeCompare(countryName(b, lang), lang === 'ru' ? 'ru' : 'en'));
}

/** Уровни детализации для загрузки карты. maxZoom — максимальный zoom тайлов. */
export const DETAIL_PRESETS = [
  { id: 'overview', maxZoom: 8 },
  { id: 'city', maxZoom: 11 },
  { id: 'street', maxZoom: 13 },
  { id: 'max', maxZoom: 14 },
] as const;
export type DetailId = (typeof DETAIL_PRESETS)[number]['id'];
