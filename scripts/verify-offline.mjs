#!/usr/bin/env node
/**
 * Сквозная проверка «приложение не ходит в интернет».
 *
 * Берёт ПРОДАКШН-сборку (без демо-кода), запускает её в Chromium, у которого разрешение имён
 * для всех внешних хостов отключено, и:
 *   1. эмулирует реальный GPS (Geolocation API) и «идёт» по улице — проверяет, что туман открывается;
 *   2. создаёт заметку с фото через интерфейс;
 *   3. записывает ВСЕ сетевые запросы страницы и воркеров — допустим только локальный origin;
 *   4. специально пробует обратиться к внешним серверам и проверяет, что CSP это блокирует.
 *
 *   npm run test:e2e
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';
import { run, startPreview } from './lib/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4175;
// Внешние имена не резолвятся вообще: любая попытка выйти в сеть провалится на уровне DNS.
process.env.TOM_BLOCK_EXTERNAL = '1';
const args = new Set(process.argv.slice(2));
if (!args.has('--no-build')) await run('npm', ['run', 'build'], { cwd: ROOT });

const server = await startPreview(join(ROOT, 'dist'), PORT);
const origin = new URL(server.url).origin;
let failed = 0;
const check = (ok, msg, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${msg}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed++;
};

const browser = await launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    geolocation: { latitude: 43.7355, longitude: 7.4227, accuracy: 8 },
    permissions: ['geolocation'],
    locale: 'ru-RU',
  });
  const requests = [];
  const failedReqs = [];
  const csp = [];
  ctx.on('request', (r) => requests.push(r.url()));
  ctx.on('requestfailed', (r) => failedReqs.push(`${r.url()} (${r.failure()?.errorText})`));
  // запросы воркеров MapLibre тоже видны на уровне контекста
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.exposeFunction('__csp', (u) => csp.push(u));
  await page.addInitScript(() => {
    localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark' }, version: 0 }));
    document.addEventListener('securitypolicyviolation', (e) => window.__csp(`${e.violatedDirective} ← ${e.blockedURI}`));
  });
  await page.goto(server.url);
  await page.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });

  // 1) реальный GPS → туман открывается
  const area = () => page.locator('.stat-pill b').first().innerText();
  await page.waitForSelector('.me', { timeout: 20000 });
  const walk = [
    [43.7355, 7.4227], [43.7358, 7.4232], [43.7362, 7.4238], [43.7367, 7.4245], [43.7372, 7.4253], [43.7378, 7.4262], [43.7385, 7.4270], [43.7392, 7.4276],
  ];
  const before = await area();
  for (const [lat, lng] of walk) {
    await ctx.setGeolocation({ latitude: lat, longitude: lng, accuracy: 8 });
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  const after = await area();
  check(before !== after, 'GPS → туман открывается', `${before} → ${after}`);
  const dist = await page.locator('.stat-pill b').nth(1).innerText();
  check(!/^0 /.test(dist), 'дистанция считается', dist);

  // прогулка приносит уровни/челленджи — закрываем поздравления, как это сделал бы игрок
  const dismiss = async () => {
    while (await page.locator('.modal-layer').count()) {
      await page.locator('.modal .btn.primary').click();
      await page.waitForTimeout(300);
    }
  };
  await dismiss();

  // 2) заметка с фото через интерфейс
  await page.locator('.tab-add').click();
  await page.waitForSelector('.sheet .input');
  await page.fill('.sheet input.input', 'Проверка офлайн');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
  await page.setInputFiles('.media-strip ~ input[accept="image/*,video/*"]', { name: 'p.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('.mthumb img', { timeout: 10000 });
  await page.locator('.sheet-foot .btn.primary').click();
  await page.waitForSelector('.toast', { timeout: 10000 });
  await dismiss();
  await page.locator('.tab').nth(1).click();
  check((await page.locator('.note-card').count()) === 1, 'заметка с фото сохранена и видна в списке');

  // 3) карту можно двигать и приближать — тайлы читаются из локального .pmtiles
  await dismiss();
  await page.locator('.tab').nth(0).click();
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(200, 400);
    await page.mouse.down();
    await page.mouse.move(200 + 80 * (i + 1), 500, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1500);

  // экран приватности (измеряет ресурсы изнутри приложения). Порядок вкладок: карта, заметки, «+», спорт, профиль
  await dismiss();
  await page.locator('.tab').nth(3).click(); // профиль (в .tab «+» не входит)
  await page.waitForTimeout(500);
  const scrollDown = () => page.evaluate(() => document.querySelector('.page-scroll').scrollTo(0, 99999));
  await scrollDown();
  await page.locator('.card.list .row').nth(4).click();
  await page.waitForTimeout(1800);
  const shown = await page.locator('.sh-num').innerText();
  check(shown === '0', 'экран «Приватность» показывает 0 внешних запросов', shown);
  await page.locator('.sheet .icon-btn[aria-label="close"]').click();

  // 3б) шлюз загрузки карт: по умолчанию выключен — iframe нет, кнопка «Скачать» недоступна
  await page.waitForTimeout(400);
  await scrollDown();
  await page.locator('.card.list .row').nth(1).click(); // «Офлайн-карты»
  await page.waitForTimeout(400);
  await page.locator('.sheet .btn.primary').first().click(); // «Добавить страну»
  await page.waitForTimeout(600);
  await page.fill('.picker .search input', 'Порту');
  await page.locator('.country-row').first().click();
  await page.waitForTimeout(500);
  check((await page.locator('iframe').count()) === 0, 'по умолчанию сетевой шлюз (iframe) отсутствует в DOM');
  check(await page.locator('.sheet .btn.primary.block').isDisabled(), 'по умолчанию кнопка «Скачать карту» недоступна');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.allowDownloads !== true), 'настройка «разрешить загрузку» по умолчанию выключена');
  // включение переключателя само по себе тоже ничего не отправляет: шлюз создаётся только по нажатию «Скачать»/«Проверить»
  await page.locator('.source-card .switch').click();
  await page.waitForTimeout(500);
  check(await page.locator('.sheet .btn.primary.block').isDisabled(), 'без адреса источника «Скачать карту» остаётся недоступной');
  check((await page.locator('iframe').count()) === 0, 'после включения загрузки iframe всё равно не создаётся до явного запроса');
  await page.locator('.source-card .switch').click(); // вернуть выключенное состояние
  await page.locator('.sheet .icon-btn[aria-label="close"]').click();
  await page.waitForTimeout(300);

  // 4) зондирование: внешние обращения должны блокироваться CSP
  const probes = await page.evaluate(async () => {
    const out = {};
    try { await fetch('https://example.com/probe'); out.fetch = 'прошёл'; } catch { out.fetch = 'заблокирован'; }
    try { await new Promise((res, rej) => { const i = new Image(); i.onload = res; i.onerror = rej; i.src = 'https://example.com/p.png'; }); out.img = 'прошёл'; } catch { out.img = 'заблокирован'; }
    try { const x = new WebSocket('wss://example.com/ws'); await new Promise((res, rej) => { x.onopen = res; x.onerror = rej; }); out.ws = 'прошёл'; } catch { out.ws = 'заблокирован'; }
    return out;
  });
  check(probes.fetch === 'заблокирован', 'fetch на внешний сервер блокируется', probes.fetch);
  check(probes.img === 'заблокирован', 'загрузка внешней картинки блокируется', probes.img);
  check(probes.ws === 'заблокирован', 'WebSocket на внешний сервер блокируется', probes.ws);
  check(csp.length >= 3, 'CSP зафиксировал попытки нарушения', `${csp.length} шт.`);

  // 5) итог по всем запросам
  const nonLocal = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:'));
  const probeReq = nonLocal.filter((u) => u.includes('example.com'));
  const real = nonLocal.filter((u) => !u.includes('example.com'));
  const local = requests.filter((u) => u.startsWith(origin));
  check(real.length === 0, `все запросы приложения — только на локальный origin (${local.length} шт.)`, real.slice(0, 3).join(', '));
  const escaped = probeReq.filter((u) => !failedReqs.some((f) => f.startsWith(u) && /csp|blocked/i.test(f)));
  check(escaped.length === 0, 'все зондирующие запросы отбиты политикой CSP (ни один не ушёл в сеть)', escaped.join(', '));
  check(local.some((u) => u.endsWith('maps/monaco.pmtiles')), 'карта читается из локального monaco.pmtiles');
  check(local.some((u) => u.includes('map-assets/fonts/')), 'шрифты карты — локальные');
  check(local.some((u) => u.includes('map-assets/sprites/')), 'спрайты карты — локальные');
  check(failedReqs.filter((u) => !u.includes('example.com')).length === 0, 'нет неудавшихся запросов', failedReqs.slice(0, 3).join(', '));
  console.log(`\nВсего запросов: ${requests.length}; локальных: ${local.length}; внешних (не считая зондов): ${real.length}`);
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`\n${failed} проверок не пройдено`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены ✔');
