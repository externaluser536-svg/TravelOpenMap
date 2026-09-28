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

async function session({ theme, lang, onboarded = true }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: lang === 'ru' ? 'ru-RU' : 'en-GB', colorScheme: theme });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await page.addInitScript(
    ([l, ob]) => localStorage.setItem('tom.prefs.v1', JSON.stringify({ state: { onboarded: ob, lang: l, theme: 'auto' }, version: 0 })),
    [lang, onboarded],
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
const tab = (page, i) => click(page, '.tab, .tab-add', i === 0 ? 0 : i === 1 ? 1 : i === 2 ? 3 : 4);
const jump = (page, z) => page.evaluate((zoom) => window.__map.jumpTo({ zoom }), z);

async function scenes(theme, lang, which) {
  const dir = `${lang}-${theme}`;
  const { ctx, page } = await seeded({ theme, lang });
  const s = (name) => shot(page, dir, name)();
  const want = (n) => !which || which.includes(n);

  if (want('map')) { await jump(page, 15.4); await s('01-map'); }
  if (want('overview')) { await jump(page, 14.3); await s('02-fog-overview'); }
  if (want('peek')) {
    await jump(page, 14.3);
    await click(page, '.fab-col .fab', 1); // «без тумана»
    await page.waitForTimeout(1200);
    await s('03-peek');
    await click(page, '.fab-col .fab', 1);
  }
  if (want('note')) {
    await jump(page, 15.4);
    await tab(page, 1); await page.waitForTimeout(500); await s('04-notes');
    await click(page, '.note-card', 1); await page.waitForTimeout(700); await s('05-note');
    await closeSheet(page);
  }
  if (want('editor')) {
    await tab(page, 0);
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
    await tab(page, 2); await page.waitForTimeout(500); await s('07-quests');
    await page.evaluate(() => document.querySelector('.page-scroll').scrollTo(0, 700));
    await s('08-challenges');
  }
  if (want('profile')) { await tab(page, 3); await page.waitForTimeout(500); await s('09-profile'); }
  if (want('compass')) {
    await tab(page, 0);
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
    await tab(page, 3);
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
    await tab(page, 3);
    await click(page, '.card.list .row', 4); await page.waitForTimeout(2200); await s('14-privacy');
    await closeSheet(page);
  }
  if (want('settings')) {
    await click(page, '.card.list .row', 0); await page.waitForTimeout(500); await s('15-settings');
    await closeSheet(page);
    await click(page, '.card.list .row', 1); await page.waitForTimeout(500); await s('16-maps');
    await closeSheet(page);
  }
  if (want('levelup')) {
    await tab(page, 0);
    await page.evaluate(() => { const st = window.__tom.useApp.getState(); st.patch({ levelUp: { ...st.level, level: st.level.level + 1 } }); st.toast({ kind: 'quest', title: 'Соседний район', text: 'Челлендж выполнен!', icon: 'map', xp: 80 }); });
    await page.waitForTimeout(1200); await s('17-levelup');
  }
  await ctx.close();
}

async function onboarding(lang) {
  const { ctx, page } = await session({ theme: 'dark', lang, onboarded: false });
  await page.waitForTimeout(800);
  await shot(page, `${lang}-dark`, '00-onboarding-1')();
  await click(page, '.onboarding .btn.primary'); await click(page, '.onboarding .btn.primary'); await click(page, '.onboarding .btn.primary');
  await shot(page, `${lang}-dark`, '00-onboarding-4')();
  await ctx.close();
}

try {
  await onboarding('ru');
  await scenes('dark', 'ru');
  await scenes('light', 'ru', ['map', 'overview', 'peek', 'quests', 'profile', 'note']);
  // английский интерфейс — только ключевые экраны
  await scenes('dark', 'en', ['map', 'quests', 'profile', 'note', 'privacy']);

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
    ['ru-dark/01-map.png', 'Туман рассеивается'], ['ru-dark/03-peek.png', 'Карта без тумана'], ['ru-dark/05-note.png', 'Заметки с фото и видео'],
    ['ru-dark/07-quests.png', 'Уровни и челленджи'], ['ru-dark/10-compass.png', 'Компас'],
  ], 'TravelOpenMap', 'Офлайн-карта OpenStreetMap · туман войны · дневник путешествий');
  await sheet('overview-en.png', [
    ['en-dark/01-map.png', 'The fog clears as you walk'], ['en-dark/05-note.png', 'Notes with photos & video'], ['en-dark/07-quests.png', 'Levels & challenges'],
    ['en-dark/09-profile.png', 'Your stats'], ['en-dark/14-privacy.png', 'Zero external requests'],
  ], 'TravelOpenMap', 'Offline OpenStreetMap · fog of war · travel journal');
  const { before, after } = await optimizeDir(OUT);
  console.log(`  ✓ PNG сжаты: ${(before / 1e6).toFixed(1)} → ${(after / 1e6).toFixed(1)} МБ`);
} finally {
  await browser.close();
  server.stop();
}
