import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ru } from '../src/i18n/ru';
import { en } from '../src/i18n/en';
import { CHALLENGES, GROUP_ORDER } from '../src/core/challenges';
import { CATEGORIES } from '../src/core/categories';
import { CHECKLIST_TEMPLATE } from '../src/core/trips';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !p.includes('/i18n/')) out.push(p);
  }
  return out;
}

describe('i18n', () => {
  it('ru и en содержат одинаковые ключи', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ru).sort());
  });

  it('все статические ключи t(...) / tn(...) из кода есть в словаре', () => {
    const used = new Set<string>();
    for (const f of walk('src')) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(?:t|tn)\(\s*'([a-zA-Z0-9_.]+)'/g)) used.add(m[1]);
      for (const m of src.matchAll(/'((?:tab|onb)\.[a-z0-9_.]+)'/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => !(k in ru));
    expect(missing).toEqual([]);
  });

  it('динамические ключи: челленджи, категории, группы, звания, задания', () => {
    const need = [
      ...CHALLENGES.flatMap((c) => [`ch.${c.id}`, `chd.${c.id}`]),
      ...CATEGORIES.map((c) => `cat.${c.id}`),
      ...GROUP_ORDER.map((g) => `group.${g}`),
      ...['wanderer', 'tourist', 'traveler', 'tracker', 'explorer', 'pathfinder', 'cartographer', 'navigator', 'legend', 'guardian'].map((k) => `title.${k}`),
      ...['distance', 'area', 'notes'].map((k) => `daily.${k}`),
      ...['Europe', 'Asia', 'Africa', 'Americas', 'Oceania', 'Antarctic', 'Other'].map((k) => `region.${k}`),
      ...['overview', 'city', 'street', 'max'].map((k) => `countries.d.${k}`),
      ...['too-large', 'aborted', 'not-vector', 'bad-url', 'network', 'timeout'].map((k) => `countries.err.${k}`),
      ...['idea', 'planned', 'booked', 'done', 'cancelled'].map((k) => `trips.status.${k}`),
      ...['plane', 'train', 'car', 'bus', 'ship', 'bike', 'other'].map((k) => `trips.tr.${k}`),
      ...['transport', 'stay', 'food', 'fun', 'shopping', 'other'].map((k) => `exp.${k}`),
      ...['docs', 'clothes', 'tech', 'health', 'misc'].map((k) => `checkg.${k}`),
      ...CHECKLIST_TEMPLATE.flatMap((g) => g.keys.map((k) => `check.${k}`)),
      ...['walk', 'run'].map((k) => `workout.type.${k}`),
    ];
    expect(need.filter((k) => !(k in ru))).toEqual([]);
  });

  it('плейсхолдеры {x} совпадают в обоих языках', () => {
    for (const k of Object.keys(ru)) {
      const a = (ru[k].match(/\{\w+\}/g) ?? []).sort();
      const b = (en[k].match(/\{\w+\}/g) ?? []).sort();
      expect(b, k).toEqual(a);
    }
  });
});
