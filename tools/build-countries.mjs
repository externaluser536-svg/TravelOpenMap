#!/usr/bin/env node
/**
 * Собирает каталог стран src/data/countries.json из пакета world-countries
 * (названия ru/en, флаг, регион, валюта, площадь, границы).
 *
 * bbox — рамка ОСНОВНОЙ территории: далёкие заморские владения (Гвиана у Франции, Гавайи у США…)
 * отбрасываются, иначе рамка охватила бы пол-планеты. Загрузка карты идёт по этой рамке.
 *
 *   node tools/build-countries.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const countries = require('world-countries');
const dataDir = join(dirname(require.resolve('world-countries')), 'data');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const ringArea = (r) => {
  let s = 0;
  for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(s) / 2;
};

function mainBbox(geo) {
  const polys = [];
  for (const f of geo.features) {
    const g = f.geometry;
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const p of list) polys.push({ ring: p[0], area: ringArea(p[0]) });
  }
  polys.sort((a, b) => b.area - a.area);
  const big = polys[0];
  const bb = (r) => r.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]);
  const c0 = bb(big.ring);
  const cx = (c0[0] + c0[2]) / 2;
  const cy = (c0[1] + c0[3]) / 2;
  let out = c0;
  for (const p of polys.slice(1)) {
    if (p.area < big.area * 0.02) continue; // мелкие острова не расширяют рамку
    const b = bb(p.ring);
    const px = (b[0] + b[2]) / 2;
    const py = (b[1] + b[3]) / 2;
    if (Math.abs(px - cx) > 60 || Math.abs(py - cy) > 40) continue; // заморские территории
    out = [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])];
  }
  return out;
}

const round = (n) => Math.round(n * 100) / 100;
const list = [];
for (const c of countries) {
  let bbox;
  try {
    bbox = mainBbox(JSON.parse(readFileSync(join(dataDir, `${c.cca3.toLowerCase()}.geo.json`), 'utf8')));
  } catch {
    const [lat, lng] = c.latlng;
    bbox = [lng - 0.5, lat - 0.5, lng + 0.5, lat + 0.5];
  }
  // небольшой запас, чтобы граница не «обрезалась»
  const pad = 0.05;
  const cl = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  list.push({
    code: c.cca2,
    ru: c.translations.rus?.common ?? c.name.common,
    en: c.name.common,
    flag: c.flag,
    region: c.region || 'Other',
    sub: c.subregion || '',
    cur: Object.keys(c.currencies ?? {})[0] ?? '',
    area: Math.round(c.area),
    lat: round(c.latlng?.[0] ?? 0),
    lng: round(c.latlng?.[1] ?? 0),
    bbox: [round(cl(bbox[0] - pad, -180, 180)), round(cl(bbox[1] - pad, -85, 85)), round(cl(bbox[2] + pad, -180, 180)), round(cl(bbox[3] + pad, -85, 85))],
  });
}
list.sort((a, b) => a.ru.localeCompare(b.ru, 'ru'));
writeFileSync(join(ROOT, 'src/data/countries.json'), JSON.stringify(list));
console.log(`Стран: ${list.length}`);
for (const code of ['MC', 'FR', 'US', 'RU', 'NZ', 'JP', 'IT']) {
  const c = list.find((x) => x.code === code);
  console.log(code, c.ru, c.flag, c.bbox.join(','), c.cur);
}
