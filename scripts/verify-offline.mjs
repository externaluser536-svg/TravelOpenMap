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
    localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест', onlinePrompted: true, tutorialSeen: true }, version: 0 }));
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

  // 3а) долгое нажатие → меню; ручное открытие и отмена тумана — тоже без сети
  await dismiss();
  const areaBeforeEdit = await area();
  await page.mouse.move(200, 420);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  check((await page.locator('.map-menu').count()) === 1, 'долгое нажатие на карте открывает меню «метка / туман / измерение»');
  await page.locator('.map-menu .mm-item').nth(1).click(); // «Открыть туман здесь»
  await page.waitForSelector('.fog-panel');
  await page.waitForTimeout(1500);
  // кисть: мазок пальцем/мышью сразу открывает туман, каждый мазок — отдельный шаг отмены
  const stroke = async (y) => {
    await page.mouse.move(70, y);
    await page.mouse.down();
    await page.mouse.move(320, y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(700);
  };
  const undoBtn = page.locator('.fp-history .icon-btn').nth(0);
  const redoBtn = page.locator('.fp-history .icon-btn').nth(1);
  check(await undoBtn.isDisabled(), 'до первого мазка отменять нечего');
  await stroke(300);
  check(await undoBtn.isEnabled(), 'кисть: мазок открывает туман и становится шагом отмены');
  await stroke(380);
  await undoBtn.click();
  await page.waitForTimeout(300);
  check((await undoBtn.isEnabled()) && (await redoBtn.isEnabled()), 'отмена возвращает один шаг (первый мазок остаётся), можно вернуть');
  await undoBtn.click();
  await page.waitForTimeout(300);
  check(await undoBtn.isDisabled(), 'вторая отмена откатывает и первый мазок');
  await redoBtn.click();
  await redoBtn.click();
  await page.waitForTimeout(300);
  check((await redoBtn.isDisabled()) && (await undoBtn.isEnabled()), 'возврат повторяет оба мазка');
  // круг: как раньше, по кнопке
  await page.locator('.fp-tool').nth(1).click();
  await page.waitForTimeout(400);
  await page.locator('.fog-panel .mp-actions .btn.primary').first().click();
  await page.waitForTimeout(1200);
  await page.locator('.fog-panel .mp-actions .btn').last().click(); // «Готово»
  await dismiss();
  await page.waitForTimeout(500);
  const areaAfterEdit = await area();
  check(areaBeforeEdit !== areaAfterEdit, 'ручное открытие тумана увеличивает открытую площадь', `${areaBeforeEdit} → ${areaAfterEdit}`);

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

  // 3б) сохранение карты страны: без согласия на онлайн-карту сначала окно с вопросом, сеть не используется
  await page.waitForTimeout(400);
  await scrollDown();
  await page.locator('.card.list .row').nth(1).click(); // «Офлайн-карты»
  await page.waitForTimeout(400);
  await page.locator('.sheet .btn.primary').last().click(); // «Выбрать страну» (выше — «карта района, где я»)
  await page.waitForTimeout(600);
  await page.fill('.picker .search input', 'Порту');
  await page.locator('.country-row').first().click();
  await page.waitForTimeout(500);
  check(await page.locator('.sheet .btn.primary.block').isEnabled(), 'кнопка сохранения карты видна и доступна сразу после выбора страны');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.onlineMaps !== true), 'онлайн-карта по умолчанию выключена');
  await page.locator('.sheet .btn.primary.block').click();
  await page.waitForSelector('.download-modal');
  check(true, 'по нажатию «Сохранить» сначала запрашивается согласие');
  await page.locator('.download-modal .btn.ghost').click(); // «Отмена»
  await page.waitForTimeout(300);
  check((await page.locator('.download-modal').count()) === 0, 'отказ закрывает окно');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state.onlineMaps !== true), 'после отказа онлайн-карта остаётся выключенной');
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

  // 6) после знакомства спрашиваем про онлайн-карту — и не выходим в сеть, пока пользователь не согласился
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
  const req2 = [];
  ctx2.on('request', (r) => req2.push(r.url()));
  const page2 = await ctx2.newPage();
  await page2.addInitScript(() => localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест', tutorialSeen: true }, version: 0 })));
  await page2.goto(server.url);
  await page2.waitForSelector('.download-modal', { timeout: 20000 });
  check(true, 'после знакомства показан вопрос про онлайн-карту');
  check(req2.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')).length === 0, 'до согласия — ни одного внешнего запроса');
  await page2.locator('.download-modal .btn.ghost').click(); // «Не сейчас»
  await page2.waitForTimeout(400);
  check((await page2.locator('.download-modal').count()) === 0, '«Не сейчас» закрывает вопрос');
  const st2 = await page2.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state);
  check(st2.onlinePrompted === true && st2.onlineMaps !== true, 'после отказа вопрос не повторяется, онлайн-карта остаётся выключенной');
  check(req2.filter((u) => !u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')).length === 0, 'после отказа внешних запросов по-прежнему нет');
  await ctx2.close();

  // 7) обучение: после знакомства предлагается, можно принять или отказаться; вопрос про карты ждёт своей очереди
  const tourCtx = async (accept) => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU' });
    const pg = await c.newPage();
    await pg.addInitScript(() => localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: true, lang: 'ru', theme: 'dark', nickname: 'Тест' }, version: 0 })));
    await pg.goto(server.url);
    await pg.waitForSelector('.tour-offer', { timeout: 20000 });
    const prefs = () => pg.evaluate(() => JSON.parse(localStorage.getItem('tom.prefs.v1')).state);
    check((await pg.locator('.download-modal').count()) === 1, 'после знакомства сначала предлагается обучение, вопрос про карты не мешает');
    if (accept) {
      await pg.locator('.tour-offer .btn.primary').click();
      await pg.waitForSelector('.tour-card');
      let steps = 0;
      let rings = 0;
      for (let i = 0; i < 30 && (await pg.locator('.tour').count()); i++) {
        steps++;
        if (await pg.locator('.tour-ring').count()) rings++;
        await pg.locator('.tour-card .btn.primary').click();
        await pg.waitForTimeout(350);
      }
      check(steps === 13 && rings >= 9, 'обучение проходит все шаги, элементы подсвечиваются', `шагов ${steps}, с подсветкой ${rings}`);
    } else {
      await pg.locator('.tour-offer .btn.ghost').click();
      await pg.waitForTimeout(400);
      check((await pg.locator('.tour').count()) === 0, 'отказ от обучения ничего не запускает');
    }
    const st = await prefs();
    check(st.tutorialSeen === true, accept ? 'после обучения оно больше не предлагается' : 'после отказа обучение больше не предлагается');
    await pg.waitForSelector('.download-modal', { timeout: 15000 });
    check(true, 'следом показывается вопрос про онлайн-карту');
    await c.close();
  };
  await tourCtx(true);
  await tourCtx(false);
} finally {
  await browser.close();
  server.stop();
}
if (failed) {
  console.error(`\n${failed} проверок не пройдено`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены ✔');
