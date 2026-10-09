#!/usr/bin/env node
/**
 * Сквозная проверка онлайн-карты (без доступа к настоящим серверам):
 *  • пока пользователь не согласился, сеть не используется;
 *  • после согласия тайлы подгружаются только с разрешённых адресов и попадают в кэш;
 *  • слои «Метро», «Активный отдых», «Высоты» появляются и рисуются;
 *  • сохранённая область и просмотренные места работают при полностью отключённой сети;
 *  • CSP по-прежнему не выпускает запросы на посторонние адреса.
 *
 * Серверы подменяются: OpenFreeMap — крошечным набором тайлов схемы OpenMapTiles (scripts/mock/gen-omt.py),
 * рельеф — настоящими тайлами AWS Terrain (если они доступны из этой среды; иначе шаги про высоты пропускаются).
 *
 *   npm run test:online
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';
import { run, startPreview } from './lib/server.mjs';
import { ALLOWED_HOSTS, ensureMockTiles, mockOnline } from './lib/mock-online.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4176;
if (!process.argv.includes('--no-build')) await run('npm', ['run', 'build:demo'], { cwd: ROOT });
ensureMockTiles();

let failed = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${msg}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};
const skip = (msg) => console.log(`⏭️  ${msg}`);

const server = await startPreview(join(ROOT, 'dist-demo'), PORT);
const origin = new URL(server.url).origin;
const browser = await launch();
const ALLOWED = ALLOWED_HOSTS;

try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', colorScheme: 'dark' });
  const hosts = new Map();
  const seen = [];
  ctx.on('request', (r) => {
    const u = new URL(r.url());
    if (u.origin !== origin && u.protocol.startsWith('http')) {
      hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
      seen.push(u.host);
    }
  });
  const counts = await mockOnline(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.addInitScript(() =>
    localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест', tutorialSeen: true, askAreaPrompts: false }, version: 0 })),
  );
  await page.goto(server.url);
  await page.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });

  // 1) после знакомства спрашиваем про онлайн-карту; до согласия — тишина
  await page.waitForSelector('.download-modal', { timeout: 20000 });
  check(true, 'после знакомства показан вопрос про онлайн-карту');
  check(seen.length === 0, 'до согласия — ни одного внешнего запроса');
  await page.locator('.download-modal .btn.primary').click();

  // 2) после согласия карта подгружается сама, только с разрешённых адресов
  await page.evaluate(() => window.__map.jumpTo({ center: [7.4205, 43.7425], zoom: 15.3 }));
  await page.waitForFunction(() => window.__map.getStyle().sources.omt && window.__map.isStyleLoaded(), null, { timeout: 20000 });
  await page.waitForTimeout(3500);
  const st1 = await page.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state);
  check(st1.onlineMaps === true && st1.onlinePrompted === true, 'согласие сохранено в настройках');
  check(counts.omt > 0, 'векторные тайлы подгружаются автоматически', `${counts.omt} шт.`);
  check([...hosts.keys()].every((h) => ALLOWED.includes(h)), 'запросы идут только на разрешённые адреса', [...hosts.keys()].join(', '));
  const roads = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['road-major', 'road-tertiary', 'road-minor'] }).length);
  check(roads > 0, 'дороги онлайн-карты отрисованы', `${roads} объектов`);

  // 2б) нажатие на место: что это — по данным карты
  await page.evaluate(() => window.__map.jumpTo({ center: [7.4181, 43.7386], zoom: 16.2 }));
  await page.waitForTimeout(3500);
  const px = await page.evaluate(() => {
    const p = window.__map.project([7.418, 43.7385]);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(px.x, px.y);
  await page.waitForSelector('.place-card', { timeout: 8000 }).catch(() => {});
  const cardTitle = (await page.locator('.place-card .pc-title b').count()) ? await page.locator('.place-card .pc-title b').innerText() : '';
  const cardSub = (await page.locator('.place-card .pc-title small').count()) ? await page.locator('.place-card .pc-title small').innerText() : '';
  check(cardTitle === 'Boulangerie', 'нажатие на место показывает его название из данных карты', cardTitle || 'карточки нет');
  check(/Пекарня/.test(cardSub), 'и тип места по-русски', cardSub);
  await page.locator('.place-card .icon-btn').click();
  check((await page.locator('.place-card').count()) === 0, 'карточка закрывается');
  await page.mouse.click(12, 400); // пустое место: карточка с координатами и подсказкой
  await page.waitForSelector('.place-card', { timeout: 5000 }).catch(() => {});
  check((await page.locator('.place-card').count()) === 1, 'нажатие на пустое место тоже даёт карточку (координаты, действия)');
  await page.locator('.place-card .icon-btn').click();
  await page.evaluate(() => window.__map.jumpTo({ center: [7.4205, 43.7425], zoom: 15.3 }));
  await page.waitForTimeout(1500);

  // 3) слои карты через интерфейс
  await page.locator('.fab[data-tour="layers"]').click();
  await page.waitForSelector('.layer-row');
  const rows = page.locator('.layer-row .switch');
  await rows.nth(0).click(); // метро
  await rows.nth(1).click(); // активный отдых
  await page.locator('.sheet .icon-btn[aria-label="close"]').click();
  await page.waitForTimeout(3500);
  const subway = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['subway-line', 'subway-tunnel'] }).length);
  check(subway > 0, 'слой «Метро»: линии отрисованы', `${subway} объектов`);
  const trails = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['trail-hike', 'trail-cycle', 'trail-track'] }).length);
  check(trails > 0, 'слой «Активный отдых»: тропы и велодорожки отрисованы', `${trails} объектов`);

  await page.locator('.fab[data-tour="layers"]').click();
  await page.waitForSelector('.layer-row');
  await page.locator('.layer-row .switch').nth(2).click(); // высоты
  await page.locator('.sheet .icon-btn[aria-label="close"]').click();
  await page.waitForTimeout(7000);
  if (!counts.demOk && counts.dem === 0) {
    skip('слой «Высоты»: рельеф недоступен из этой среды — шаг пропущен');
  } else {
    const contours = await page.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['contour'] }).length);
    check(counts.dem > 0, 'рельеф подгружается с AWS Terrain и кэшируется', `${counts.dem} шт.`);
    check(contours > 0, 'слой «Высоты»: изолинии построены из рельефа', `${contours} объектов`);
    check(await page.evaluate(() => !!window.__map.getLayer('hillshade')), 'слой «Высоты»: тени рельефа включены');
  }
  check([...hosts.keys()].every((h) => ALLOWED.includes(h)), 'со слоями запросы по-прежнему только на разрешённые адреса', [...hosts.keys()].join(', '));

  // 4) сохранение области для офлайна
  await page.locator('.tab').nth(3).click(); // профиль
  await page.waitForTimeout(400);
  await page.evaluate(() => document.querySelector('.page-scroll').scrollTo(0, 99999));
  await page.locator('.card.list .row').nth(1).click(); // «Офлайн-карты»
  await page.waitForSelector('.sheet');
  await page.locator('.sheet .btn.primary.block').click(); // «Выбрать страну»
  await page.fill('.picker .search input', 'Монако');
  await page.locator('.country-row').first().click();
  await page.locator('.detail-card').nth(1).click(); // «Города»
  await page.locator('.sheet .btn.primary.block').click(); // «Сохранить для офлайна»
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.savedAreas?.length > 0, null, { timeout: 60000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.savedAreas);
  check(saved.length === 1 && saved[0].tiles > 0, 'область сохранена для офлайна', `${saved[0]?.name} · ${saved[0]?.tiles} тайлов`);
  await page.waitForTimeout(500);

  // 5) полностью без сети: карта берётся из кэша
  await page.close();
  // «нет сети»: любые внешние запросы обрываются; страницу открываем, пока сеть ещё есть, и затем отключаем
  await ctx.unrouteAll({ behavior: 'wait' });
  let blocked = 0;
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (route) => {
    blocked++;
    return route.abort('internetdisconnected');
  });
  const before = counts.omt;
  const page2 = await ctx.newPage();
  await page2.addInitScript(() => Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false })); // режим «в самолёте»
  await page2.goto(server.url);
  await page2.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });
  await page2.evaluate(() => window.__map.jumpTo({ center: [7.4205, 43.7425], zoom: 15.3 }));
  await page2.waitForTimeout(4000);
  const offRoads = await page2.evaluate(() => window.__map.queryRenderedFeatures({ layers: ['road-major', 'road-tertiary', 'road-minor'] }).length);
  check(offRoads > 0, 'без сети карта рисуется из кэша', `${offRoads} объектов`);
  check(counts.omt === before && blocked === 0, 'без сети приложение даже не пытается обратиться к серверу', `попыток: ${blocked}`);

  // 6) посторонние адреса по-прежнему закрыты CSP
  const probe = await page2.evaluate(async () => {
    try {
      await fetch('https://example.com/probe');
      return 'прошёл';
    } catch {
      return 'заблокирован';
    }
  });
  check(probe === 'заблокирован', 'fetch на посторонний сервер блокируется CSP', probe);

  // 7) выключили онлайн-карту — сеть больше не используется вообще
  await page2.evaluate(() => {
    const v = JSON.parse(localStorage.getItem('tom.prefs.v1'));
    v.state.onlineMaps = false;
    localStorage.setItem('tom.prefs.v1', JSON.stringify(v));
  });
  await page2.reload();
  await page2.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });
  const n0 = seen.length;
  await page2.evaluate(() => window.__map.jumpTo({ center: [2.35, 48.85], zoom: 11 }));
  await page2.waitForTimeout(2500);
  check(seen.length === n0, 'при выключенной онлайн-карте новых внешних запросов нет');
  console.log(`\nВнешних запросов по адресам: ${JSON.stringify(Object.fromEntries(hosts))}`);

  // 8) первый запуск: карта не привязана к Монако, а после GPS предлагается карта района, где вы находитесь
  const ctxNoGps = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  await mockOnline(ctxNoGps);
  const pg0 = await ctxNoGps.newPage();
  await pg0.addInitScript(() => localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест', tutorialSeen: true, onlinePrompted: true }, version: 0 })));
  await pg0.goto(server.url);
  await pg0.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });
  const z0 = await pg0.evaluate(() => ({ z: window.__map.getZoom(), c: window.__map.getCenter() }));
  check(z0.z < 4 && !(Math.abs(z0.c.lng - 7.42) < 1 && Math.abs(z0.c.lat - 43.74) < 1), 'без положения карта открывается на мировом виде, а не на Монако', `zoom ${z0.z.toFixed(1)}`);
  await ctxNoGps.close();

  const ctxGps = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    geolocation: { latitude: 43.7384, longitude: 7.4246, accuracy: 12 },
    permissions: ['geolocation'],
  });
  await mockOnline(ctxGps);
  const pg1 = await ctxGps.newPage();
  await pg1.addInitScript(() => localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест', tutorialSeen: true }, version: 0 })));
  await pg1.goto(`${server.url}?gps`);
  await pg1.waitForSelector('.download-modal', { timeout: 20000 });
  await pg1.locator('.download-modal .btn.primary').click(); // разрешаем онлайн-карту
  await pg1.waitForSelector('.area-prompt', { timeout: 20000 }).catch(() => {});
  const hereText = (await pg1.locator('.area-prompt').count()) ? await pg1.locator('.area-prompt').first().innerText() : '';
  check(/Монако/.test(hereText), 'после GPS предлагается сохранить карту района, где вы находитесь', hereText.replace(/\n/g, ' ').slice(0, 70));
  const zNow = await pg1.evaluate(() => window.__map.getZoom());
  check(zNow > 12, 'карта сама перелетела к вашему положению', `zoom ${zNow.toFixed(1)}`);
  await pg1.locator('.area-prompt .btn.primary').click();
  await pg1.waitForFunction(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.savedAreas?.length > 0, null, { timeout: 60000 }).catch(() => {});
  const savedHere = await pg1.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.savedAreas ?? []);
  check(savedHere.length === 1, 'область «здесь» сохраняется одним нажатием', savedHere[0]?.name ?? '');
  await ctxGps.close();
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`\n${failed} проверок не пройдено`);
  process.exit(1);
}
console.log('\nВсе проверки онлайн-карты пройдены ✔');
