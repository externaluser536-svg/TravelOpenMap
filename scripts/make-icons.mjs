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
// иконка целиком (скруглённый квадрат прямо в svg, поэтому фон — градиент, чтобы не было прозрачных углов)
await render('icon-only.png', 1024, `<div style="width:1024px;height:1024px;background:linear-gradient(135deg,#3DDC97,#6C8CFF)">${svg.replace('<svg ', '<svg width="1024" height="1024" ').replace(/rx="112"/g, 'rx="0"')}</div>`);
await render('icon-background.png', 1024, '<div style="width:1024px;height:1024px;background:linear-gradient(135deg,#3DDC97,#6C8CFF)"></div>');
// передний план адаптивной иконки: только компас в безопасной зоне (66%)
await render('icon-foreground.png', 1024, `<div style="width:1024px;height:1024px;display:grid;place-items:center"><svg width="640" height="640" viewBox="96 96 320 320"><circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="18"/><path d="M256 128 L296 256 L256 384 L216 256 Z" fill="#fff"/><path d="M256 128 L296 256 L216 256 Z" fill="#FF6B6B"/><circle cx="256" cy="256" r="16" fill="#0B1220"/></svg></div>`, true);
const splash = (bg) => `<div style="width:2732px;height:2732px;background:${bg};display:grid;place-items:center">${inline(640, 'border-radius:150px;overflow:hidden;box-shadow:0 40px 120px rgba(61,220,151,.35)')}</div>`;
await render('splash.png', 2732, splash('#0B1220'));
await render('splash-dark.png', 2732, splash('#0B1220'));
await b.close();
console.log('resources/*.png готовы');
