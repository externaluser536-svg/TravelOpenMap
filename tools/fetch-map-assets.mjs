#!/usr/bin/env node
/**
 * Скачивает ОДИН РАЗ шрифты (glyph PBF) и спрайты карты из открытого репозитория
 * protomaps/basemaps-assets и кладёт в public/map-assets/.
 * После этого приложению интернет не нужен — все ресурсы карты лежат локально.
 *
 *   npm run assets:fonts
 *
 * Лицензии: шрифты Noto Sans — SIL OFL 1.1, спрайты — CC0/ODbL (см. репозиторий-источник).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map-assets');

const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Диапазоны Unicode: латиница, кириллица, греческий, пунктуация, стрелки/символы.
const RANGES = [
  '0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535',
  '7680-7935', '7936-8191', '8192-8447', '8448-8703',
];
const SPRITES = ['light', 'dark'].flatMap((f) =>
  ['', '@2x'].flatMap((r) => [`sprites/v4/${f}${r}.json`, `sprites/v4/${f}${r}.png`]),
);

async function get(path) {
  const res = await fetch(`${BASE}/${path.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return Buffer.from(await res.arrayBuffer());
}

const jobs = [
  ...FONTS.flatMap((f) => RANGES.map((r) => `fonts/${f}/${r}.pbf`)),
  ...SPRITES,
  'fonts/OFL.txt',
];
let done = 0;
await Promise.all(
  jobs.map(async (p) => {
    const dest = join(OUT, p.replace(/^sprites\/v4\//, 'sprites/'));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, await get(p));
    done++;
  }),
);
console.log(`Готово: ${done}/${jobs.length} файлов → ${OUT}`);
