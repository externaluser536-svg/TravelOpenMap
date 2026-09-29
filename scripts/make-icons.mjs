#!/usr/bin/env node
/** Рисует исходники иконки и сплэша (resources/*.png) из public/icon.svg. Далее: npx capacitor-assets generate */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(ROOT, 'public/icon.svg'), 'utf8');
await mkdir(join(ROOT, 'resources'), { recursive: true });
const b = await launch();
async function render(name, size, html, transparent = false) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}</style>${html}`);
  await writeFile(join(ROOT, 'resources', name), await p.screenshot({ omitBackground: transparent }));
  await p.close();
}
const inline = (w, extra = '') => `<div style="width:${w}px;height:${w}px;${extra}">${svg.replace('<svg ', `<svg width="${w}" height="${w}" `)}</div>`;
// Иконка собирается из двух слоёв внутри public/icon.svg: #bg (фон) и #fg (метка).
const layer = (keep, { round = true } = {}) => {
  let x = svg;
  const drop = keep === 'bg' ? 'fg' : keep === 'fg' ? 'bg' : null;
  if (drop) x = x.replace(new RegExp(`<g id="${drop}"[\\s\\S]*?\\n  </g>\\n`), '');
  if (!round) x = x.replace(/rx="112"/g, 'rx="0"').replace(/<rect id="rim"[^>]*\/>\n/, '');
  return x;
};
const sized = (x, w) => x.replace('<svg ', `<svg width="${w}" height="${w}" `);
// иконка целиком: без скруглений (углы дорисует система)
await render('icon-only.png', 1024, `<div style="width:1024px;height:1024px;background:#070B1E">${sized(layer('all', { round: false }), 1024)}</div>`);
await render('icon-background.png', 1024, `<div style="width:1024px;height:1024px;background:#070B1E">${sized(layer('bg', { round: false }), 1024)}</div>`);
// передний план адаптивной иконки: метка в безопасной зоне (66%) на прозрачном фоне
await render(
  'icon-foreground.png',
  1024,
  `<div style="width:1024px;height:1024px;display:grid;place-items:center">${sized(layer('fg').replace('viewBox="0 0 512 512"', 'viewBox="66 56 380 380"'), 720)}</div>`,
  true,
);
const splash = (bg) => `<div style="width:2732px;height:2732px;background:${bg};display:grid;place-items:center">${inline(640, 'border-radius:150px;overflow:hidden;box-shadow:0 40px 120px rgba(61,220,151,.35)')}</div>`;
await render('splash.png', 2732, splash('#0B1220'));
await render('splash-dark.png', 2732, splash('#0B1220'));
// значок для README (со скруглением, на прозрачном фоне)
{
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  await p.setContent(`<style>html,body{margin:0;width:512px;height:512px;overflow:hidden;background:transparent}</style>${sized(layer('all'), 512)}`);
  await mkdir(join(ROOT, 'docs/screenshots'), { recursive: true });
  await writeFile(join(ROOT, 'docs/screenshots/app-icon.png'), await p.screenshot({ omitBackground: true }));
  await p.close();
}
await b.close();
console.log('resources/*.png и docs/screenshots/app-icon.png готовы');
