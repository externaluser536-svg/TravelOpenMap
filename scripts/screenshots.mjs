#!/usr/bin/env node
/**
 * Снимает скриншоты приложения для README.
 *
 * Собирает demo-сборку (реальный код приложения + демо-данные: настоящий пеший маршрут
 * по улицам Монако, проигранный через тот же движок, что и живой GPS), поднимает сервер и
 * проходит по экранам, кликая по настоящему интерфейсу. Затем собирает обзорную картинку
 * с рамками устройств.
 *
 *   npm run screenshots            # пересобрать demo и снять всё
 *   npm run screenshots -- --no-build
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './lib/browser.mjs';
import { run, startPreview } from './lib/server.mjs';
import { optimizeDir } from './lib/optimize.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const PORT = 4174;
const args = new Set(process.argv.slice(2));

if (!args.has('--no-build')) await run('npm', ['run', 'build:demo'], { cwd: ROOT });
const server = await startPreview(join(ROOT, 'dist-demo'), PORT);
const browser = await launch();
await mkdir(OUT, { recursive: true });

async function session({ theme, lang, onboarded = true, world = true }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === 'ru' ? 'ru-RU' : 'en-GB', colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.addInitScript(
    ([l, ob, wp]) =>
      localStorage.setItem(
        'tom.prefs.v1',
        // worldPrompted: true — вопрос про обзор мира не перекрывает остальные кадры
        JSON.stringify({ state: { onboarded: ob, lang: l, theme: 'auto', worldPrompted: wp, ...(ob ? { nickname: l === 'ru' ? 'Алекс' : 'Alex', avatarIcon: 'mountain', avatarColor: '#6C8CFF' } : {}) }, version: 0 }),
      ),
    [lang, onboarded, world],
  );
  await page.goto(server.url);
  await page.waitForSelector('[data-map-ready="1"]', { timeout: 60000 });
  return { ctx, page };
}

async function seeded(opts) {
  const s = await session(opts);
  await s.page.waitForFunction(() => window.__tom);
  await s.page.evaluate(() => window.__tom.seedDemo());
  await s.page.waitForTimeout(3500);
  return s;
}

const shot = (page, dir, name) => async () => {
  await page.waitForTimeout(800);
  await mkdir(join(OUT, dir), { recursive: true });
  await page.screenshot({ path: join(OUT, dir, `${name}.png`) });
  console.log('  ✓', dir, name);
};
const click = (page, sel, n = 0) => page.locator(sel).nth(n).click();
const closeSheet = (page) => click(page, '.sheet .icon-btn[aria-label="close"]');
// порядок в нижней панели: карта, заметки, «+», спорт, профиль
const TAB = { map: 0, notes: 1, add: 2, workout: 3, profile: 4 };
const tab = (page, name) => click(page, '.tab, .tab-add', TAB[name]);
const subtab = (page, i) => click(page, '.sticky-seg .seg button', i);
const jump = (page, z) => page.evaluate((zoom) => window.__map.jumpTo({ zoom }), z);
const scrollPage = (page, y) => page.evaluate((top) => document.querySelector('.page-scroll').scrollTo(0, top), y);

async function scenes(theme, lang, which) {
  const dir = `${lang}-${theme}`;
  const { ctx, page } = await seeded({ theme, lang });
  const s = (name) => shot(page, dir, name)();
  const want = (n) => !which || which.includes(n);

  if (want('map')) { await jump(page, 15.4); await s('01-map'); }
  if (want('overview')) { await jump(page, 14.3); await s('02-fog-overview'); }
  if (want('wind')) {
    // ветер: три кадра одного и того же места с интервалом в 3 с — облака дрейфуют
    await jump(page, 14.6);
    await page.waitForTimeout(1500);
    const frames = [];
    for (let i = 0; i < 3; i++) {
      frames.push(await page.screenshot({ clip: { x: 0, y: 190, width: 390, height: 330 } }));
      await page.waitForTimeout(3000);
    }
    const sharp = (await import('sharp')).default;
    const W = 390 * 2;
    const H = 330 * 2;
    const g = 16;
    await mkdir(join(OUT, dir), { recursive: true });
    await sharp({ create: { width: W * 3 + g * 2, height: H, channels: 3, background: '#0b1220' } })
      .composite(await Promise.all(frames.map(async (f, i) => ({ input: await sharp(f).resize(W, H).toBuffer(), left: i * (W + g), top: 0 }))))
      .png()
      .toFile(join(OUT, dir, '28-fog-wind.png'));
    console.log('  ✓', dir, '28-fog-wind');
  }
  if (want('peek')) {
    await jump(page, 14.3);
    await click(page, '.fab-col .fab', 1); // «без тумана»
    await page.waitForTimeout(1200);
    await s('03-peek');
    await click(page, '.fab-col .fab', 1);
  }
  if (want('note')) {
    await jump(page, 15.4);
    await tab(page, 'notes'); await page.waitForTimeout(500); await s('04-notes');
    await click(page, '.note-card', 1); await page.waitForTimeout(700); await s('05-note');
    await closeSheet(page);
  }
  if (want('editor')) {
    await tab(page, 'map');
    await click(page, '.tab-add');
    await page.waitForTimeout(500);
    const jpeg = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 900; c.height = 600; const g = c.getContext('2d');
      const sky = g.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, '#ff9a5a'); sky.addColorStop(1, '#5b3f9e'); g.fillStyle = sky; g.fillRect(0, 0, 900, 600);
      g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(640, 250, 70, 0, 7); g.fill();
      g.fillStyle = '#2b1e57'; g.beginPath(); g.moveTo(0, 420); for (let x = 0; x <= 900; x += 45) g.lineTo(x, 380 + Math.sin(x / 90) * 40); g.lineTo(900, 600); g.lineTo(0, 600); g.fill();
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    });
    await page.setInputFiles('.media-strip ~ input[accept="image/*,video/*"]', { name: 'sunset.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpeg, 'base64') });
    await page.waitForTimeout(700);
    await page.fill('.form input.input', lang === 'ru' ? 'Закат над бухтой' : 'Sunset over the bay');
    await page.fill('.form textarea', lang === 'ru' ? 'Лучшее место для вечерней прогулки — весь порт как на ладони.' : 'The best spot for an evening walk — the whole harbour at a glance.');
    await click(page, '.cat', 6);
    await s('06-editor');
    await closeSheet(page);
  }
  if (want('quests')) {
    await tab(page, 'profile'); await subtab(page, 1); await page.waitForTimeout(500); await s('07-quests');
    await scrollPage(page, 760);
    await s('08-challenges');
  }
  if (want('stats')) {
    await tab(page, 'profile'); await subtab(page, 0); await scrollPage(page, 0); await page.waitForTimeout(600);
    await s('09-profile');
    await scrollPage(page, 560); await s('09b-charts');
    await scrollPage(page, 1180); await s('09c-calendar');
    await scrollPage(page, 1900); await s('09d-donut');
  }
  if (want('compass')) {
    await tab(page, 'map');
    await page.evaluate(() => { const st = window.__tom.useApp.getState(); const n = st.notes.find((x) => /Порт|Port/.test(x.title)) ?? st.notes[0]; st.patch({ compassTarget: { lng: n.lng, lat: n.lat, name: n.title } }); });
    await click(page, '.compass-pill'); await page.waitForTimeout(500); await s('10-compass');
    await closeSheet(page);
  }
  if (want('measure')) {
    await jump(page, 15.4);
    await click(page, '.fab-col .fab', 2);
    for (const [x, y] of [[200, 520], [250, 400], [290, 300]]) { await page.mouse.click(x, y); await page.waitForTimeout(200); }
    await s('11-measure');
    await click(page, '.mode-panel .icon-btn');
  }
  if (want('zones')) {
    await tab(page, 'profile'); await subtab(page, 0); await scrollPage(page, 99999);
    await click(page, '.card.list .row', 2); await page.waitForTimeout(400);
    await click(page, '.sheet .btn.primary'); await page.waitForTimeout(1500);
    await page.evaluate(() => { const st = window.__tom.useApp.getState(); st.patch({ zoneDraft: { ...st.zoneDraft, radius: 260, name: st.zoneDraft.name } }); });
    await page.waitForTimeout(700);
    await s('12-zone');
    await click(page, '.mode-panel .btn.primary'); await page.waitForTimeout(500);
    await s('13-zones-list');
    await closeSheet(page);
  }
  if (want('privacy')) {
    await tab(page, 'profile'); await subtab(page, 0); await scrollPage(page, 99999);
    await click(page, '.card.list .row', 4); await page.waitForTimeout(2200); await s('14-privacy');
    await closeSheet(page);
  }
  if (want('settings')) {
    await scrollPage(page, 99999);
    await click(page, '.card.list .row', 0); await page.waitForTimeout(500); await s('15-settings');
    await page.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 560)); await s('15b-theme');
    await closeSheet(page);
    await click(page, '.card.list .row', 1); await page.waitForTimeout(500); await s('16-maps');
    await closeSheet(page);
  }
  if (want('countries')) {
    await tab(page, 'profile'); await subtab(page, 0); await scrollPage(page, 99999);
    await click(page, '.card.list .row', 1); await page.waitForTimeout(400);
    await click(page, '.sheet .btn.primary'); await page.waitForTimeout(600);
    await page.fill('.picker .search input', lang === 'ru' ? 'и' : 'i');
    await s('26-countries');
    await page.fill('.picker .search input', lang === 'ru' ? 'Португ' : 'Portu');
    await click(page, '.country-row'); await page.waitForTimeout(500);
    await s('27-country');
    await closeSheet(page);
  }
  if (want('workout')) {
    await tab(page, 'workout'); await page.waitForTimeout(600); await s('18-workout');
    await scrollPage(page, 640); await s('18b-workout-history');
    await scrollPage(page, 0);
    await click(page, '.wk-card', 2); await page.waitForTimeout(600); await s('21-workout-detail');
    await page.evaluate(() => document.querySelector('.sheet-body').scrollTo(0, 620)); await s('21b-workout-detail');
    await closeSheet(page);
    // идущая тренировка: старт через интерфейс и поток GPS-фиксов
    await page.evaluate(() => {
      const { workoutEngine, route, useApp } = window.__tom;
      const now = Date.now();
      useApp.getState().patch({ position: null });
      workoutEngine.start('run', now - 512000);
      for (let i = 120; i < 330; i++) workoutEngine.onFix({ lng: route[i][0], lat: route[i][1], t: now - 512000 + (i - 120) * 2440, accuracy: 6, alt: 28 + (i - 120) * 0.06 });
      useApp.getState().patch({ position: { lng: route[329][0], lat: route[329][1], t: now, accuracy: 6 }, gps: 'ok' });
    });
    await page.waitForTimeout(800); await s('19-workout-live');
    await tab(page, 'map');
    await page.evaluate(() => { const r = window.__tom.route; window.__map.jumpTo({ center: r[240], zoom: 15.4 }); });
    await page.waitForTimeout(800); await s('20-workout-map');
    await tab(page, 'workout');
    await page.evaluate(() => window.__tom.workoutEngine.discard());
  }
  if (want('trips')) {
    await tab(page, 'profile'); await subtab(page, 2); await page.waitForTimeout(600); await s('22-trips');
    await click(page, '.trip-card', 0); await page.waitForTimeout(600); await s('23-trip');
    await click(page, '.seg.wide button', 1); await s('24-trip-plan');
    await click(page, '.seg.wide button', 2); await s('24b-trip-check');
    await click(page, '.seg.wide button', 3); await s('25-trip-budget');
    await closeSheet(page);
    await click(page, '.round-add'); await page.waitForTimeout(600);
    await click(page, '.pick-btn'); await page.fill('.picker .search input', lang === 'ru' ? 'Гре' : 'Gre'); await page.waitForTimeout(300);
    await click(page, '.country-row'); await page.waitForTimeout(400);
    await click(page, '.chip-btn', 1); await page.waitForTimeout(500); await s('25b-trip-editor');
    await closeSheet(page);
  }
  if (want('mapedit')) {
    // группы меток, меню долгого нажатия, правка тумана (круг — открыть, область — закрыть)
    await tab(page, 'map'); await jump(page, 13.4); await page.waitForTimeout(1600); await s('29-clusters');
    await jump(page, 15.6); await page.waitForTimeout(900);
    await page.mouse.move(120, 300); await page.mouse.down(); await page.waitForTimeout(800); await page.mouse.up();
    await s('30-menu');
    await click(page, '.mm-item', 1); await page.waitForTimeout(1800);
    await s('31-fog-open');
    await click(page, '.fog-panel .fp-segs .seg:nth-child(1) button', 1);
    await click(page, '.fog-panel .fp-segs .seg:nth-child(2) button', 1);
    for (const [x, y] of [[60, 150], [330, 130], [340, 330], [90, 340]]) { await page.mouse.click(x, y); await page.waitForTimeout(150); }
    await s('32-fog-area');
    await click(page, '.fog-panel .icon-btn');
  }
  if (want('levelup')) {
    await tab(page, 'map');
    await page.evaluate(() => { const st = window.__tom.useApp.getState(); st.patch({ levelUp: { ...st.level, level: st.level.level + 1 } }); st.toast({ kind: 'quest', title: 'Соседний район', text: 'Челлендж выполнен!', icon: 'map', xp: 80 }); });
    await page.waitForTimeout(1200); await s('17-levelup');
  }
  await ctx.close();
}

async function onboarding(lang) {
  const { ctx, page } = await session({ theme: 'dark', lang, onboarded: false });
  const dir = `${lang}-dark`;
  await page.waitForTimeout(800);
  await shot(page, dir, '00-onboarding-1')();
  const next = () => click(page, '.onboarding .btn.primary');
  for (let i = 0; i < 4; i++) { await next(); await page.waitForTimeout(250); }
  await shot(page, dir, '00-onboarding-look')();
  await next(); await page.waitForTimeout(300);
  await page.locator('.onboarding .btn.primary').click({ force: true }); // без ника — показывает ошибку и не пускает дальше
  await page.waitForTimeout(300);
  await shot(page, dir, '00-onboarding-nick-required')();
  await page.fill('.onboarding input.input', lang === 'ru' ? 'Алекс' : 'Alex');
  await click(page, '.pf-ic', 1);
  await shot(page, dir, '00-onboarding-me')();
  await ctx.close();
}

// вопросы про загрузку карт: обзор мира после знакомства, область при приближении, согласие в листе страны
async function downloadPrompts(lang) {
  const dir = `${lang}-dark`;
  const { ctx, page } = await session({ theme: 'dark', lang, world: false });
  await page.waitForSelector('.download-modal', { timeout: 15000 });
  await shot(page, dir, '33-world-prompt')();
  await page.locator('.download-modal .btn.ghost').click(); // «Не сейчас»
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__map.jumpTo({ zoom: 9, center: [2.35, 48.85] }); });
  await page.waitForSelector('.area-prompt', { timeout: 15000 });
  await page.waitForTimeout(500);
  await shot(page, dir, '34-area-prompt')();
  await page.locator('.area-prompt .btn.primary').click(); // без разрешения — окно согласия
  await page.waitForSelector('.download-modal');
  await shot(page, dir, '35-consent')();
  await ctx.close();
}

try {
  await onboarding('ru');
  await onboarding('en');
  await downloadPrompts('ru');
  await downloadPrompts('en');
  await scenes('dark', 'ru');
  await scenes('light', 'ru', ['map', 'overview', 'peek', 'quests', 'stats', 'note', 'workout', 'trips', 'mapedit']);
  // английский интерфейс — только ключевые экраны
  await scenes('dark', 'en', ['map', 'quests', 'stats', 'note', 'privacy', 'settings', 'workout', 'trips', 'countries', 'mapedit']);

  // ---- обзор с рамками устройств
  const img = async (p) => `data:image/png;base64,${(await readFile(join(OUT, p))).toString('base64')}`;
  async function sheet(name, items, title, sub) {
    const cells = await Promise.all(items.map(async ([p, cap]) => `<figure><div class="phone"><img src="${await img(p)}"></div><figcaption>${cap}</figcaption></figure>`));
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:radial-gradient(120% 80% at 50% 0%,#1d2b55,#0b1220 70%);font-family:'Inter Variable',system-ui,sans-serif;color:#eaf0ff;padding:64px 56px 56px}
      h1{margin:0;font-size:54px;letter-spacing:-.03em} p{margin:8px 0 44px;color:#93a1c2;font-size:24px}
      .row{display:flex;gap:34px;justify-content:center} figure{margin:0;text-align:center}
      .phone{width:330px;border-radius:52px;padding:11px;background:#05080f;box-shadow:0 0 0 2px #2b3552,0 30px 70px rgba(0,0,0,.6)}
      .phone img{display:block;width:100%;border-radius:42px} figcaption{margin-top:18px;font-size:22px;font-weight:650;color:#c9d4f2}
    </style><h1>${title}</h1><p>${sub}</p><div class="row">${cells.join('')}</div>`;
    const p = await browser.newPage({ viewport: { width: 56 * 2 + items.length * 330 + (items.length - 1) * 34 + items.length * 22, height: 1000 }, deviceScaleFactor: 1 });
    await p.setContent(html);
    await p.waitForTimeout(500);
    await p.screenshot({ path: join(OUT, name), fullPage: true });
    await p.close();
    console.log('  ✓', name);
  }
  await sheet('overview-ru.png', [
    ['ru-dark/01-map.png', 'Туман с ветром'], ['ru-dark/03-peek.png', 'Карта без тумана'], ['ru-dark/05-note.png', 'Заметки с фото и видео'],
    ['ru-dark/07-quests.png', 'Уровни и челленджи'], ['ru-dark/10-compass.png', 'Компас'],
  ], 'TravelOpenMap', 'Офлайн-карта OpenStreetMap · туман войны · дневник путешествий');
  await sheet('overview-ru-2.png', [
    ['ru-dark/09b-charts.png', 'Статистика в графиках'], ['ru-dark/19-workout-live.png', 'Тренировка: бег и ходьба'], ['ru-dark/21-workout-detail.png', 'Маршрут и площадь охвата'],
    ['ru-dark/22-trips.png', 'Планы поездок'], ['ru-dark/27-country.png', 'Карты по странам'],
  ], 'TravelOpenMap 0.2', 'Тренировки · графики · планировщик поездок · загрузка карт по странам');
  await sheet('overview-ru-3.png', [
    ['ru-dark/29-clusters.png', 'Метки собираются в группы'], ['ru-dark/30-menu.png', 'Долгое нажатие: метка в любом месте'], ['ru-dark/31-fog-open.png', 'Открыть туман кругом'],
    ['ru-dark/32-fog-area.png', 'Закрыть область'],
  ], 'TravelOpenMap 0.3', 'Группировка меток · метки в любом месте · ручная правка тумана');
  await sheet('overview-ru-5.png', [
    ['ru-dark/33-world-prompt.png', 'После знакомства: обзор мира'], ['ru-dark/34-area-prompt.png', 'Приближение: карта области'], ['ru-dark/35-consent.png', 'Загрузка — только с вашего разрешения'],
    ['ru-dark/27-country.png', 'Кнопка «Скачать карту» в стране'],
  ], 'TravelOpenMap 0.5', 'Обзор мира · карты областей при приближении · согласие на загрузку');
  await sheet('overview-en-5.png', [
    ['en-dark/33-world-prompt.png', 'After onboarding: world overview'], ['en-dark/34-area-prompt.png', 'Zooming in: area map'], ['en-dark/35-consent.png', 'Downloads only with your consent'],
    ['en-dark/27-country.png', 'Download button in a country'],
  ], 'TravelOpenMap 0.5', 'World overview · area maps when zooming in · download consent');
  await sheet('overview-ru-4.png', [
    ['ru-dark/00-onboarding-look.png', 'Первый запуск: оформление'], ['ru-dark/00-onboarding-me.png', 'Знакомство: ник обязателен'], ['ru-dark/15b-theme.png', 'Тема: системная, светлая, тёмная'],
    ['ru-dark/09-profile.png', 'Профиль с ником и аватаром'],
  ], 'TravelOpenMap 0.4', 'Знакомство · выбор темы · release-сборки');
  await sheet('overview-en.png', [
    ['en-dark/01-map.png', 'The fog clears as you walk'], ['en-dark/05-note.png', 'Notes with photos & video'], ['en-dark/07-quests.png', 'Levels & challenges'],
    ['en-dark/09b-charts.png', 'Stats in charts'], ['en-dark/14-privacy.png', 'Zero external requests'],
  ], 'TravelOpenMap', 'Offline OpenStreetMap · fog of war · travel journal');
  await sheet('overview-en-2.png', [
    ['en-dark/19-workout-live.png', 'Workouts: run & walk'], ['en-dark/22-trips.png', 'Trip planner'], ['en-dark/27-country.png', 'Country maps'],
    ['en-dark/21-workout-detail.png', 'Route & covered area'], ['en-dark/09c-calendar.png', 'Activity calendar'],
  ], 'TravelOpenMap 0.2', 'Workouts · charts · trip planner · country map downloads');
  await sheet('overview-en-3.png', [
    ['en-dark/29-clusters.png', 'Pins group into clusters'], ['en-dark/30-menu.png', 'Long-press: pin anywhere'], ['en-dark/31-fog-open.png', 'Reveal fog with a circle'],
    ['en-dark/32-fog-area.png', 'Cover an area'],
  ], 'TravelOpenMap 0.3', 'Pin clustering · pins anywhere · manual fog editing');
  await sheet('overview-en-4.png', [
    ['en-dark/00-onboarding-look.png', 'First run: look & feel'], ['en-dark/00-onboarding-me.png', 'Getting acquainted: nickname required'], ['en-dark/15b-theme.png', 'Theme: system, light, dark'],
    ['en-dark/09-profile.png', 'Profile with nickname and avatar'],
  ], 'TravelOpenMap 0.4', 'Onboarding · theme choice · release builds');
  const { before, after } = await optimizeDir(OUT);
  console.log(`  ✓ PNG сжаты: ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} МБ`);
} finally {
  await browser.close();
  server.stop();
}
