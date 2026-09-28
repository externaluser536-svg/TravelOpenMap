// Демо-данные для скриншотов и разработки. Подключается только в режимах `dev` и `demo`
// и не попадает в боевую сборку.
//
// Маршрут — реальная пешая дорожка по улицам Монако (tools/make-demo-route.py), которая
// «проигрывается» через тот же движок, что и настоящий GPS: тайминги, туман, статистика,
// XP и челленджи считаются ровно так же, как у живого пользователя.

import route from './demo-route.json';
import { engine } from '../state/engine';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { putMedia, uid, type Note } from '../data/db';
import { haversine } from '../core/geo';

type P = [number, number];
const ROUTE = route as P[];
const DAY = 86400000;

const LANDMARKS: { at: P; cat: string; title: string; text: string; scene: Scene; hour: number }[] = [
  { at: [7.4227, 43.7355], cat: 'sight', title: 'Порт Эркюль', text: 'Утро в порту: яхты, тишина и запах кофе. Лучший вид — с набережной у Yacht Club.', scene: 'harbor', hour: 10 },
  { at: [7.4276, 43.7397], cat: 'sight', title: 'Казино Монте-Карло', text: 'Фасад вечером подсвечивают тёплым светом. Внутрь только в пиджаке — проверили на себе.', scene: 'casino', hour: 19 },
  { at: [7.4258, 43.7318], cat: 'nature', title: 'Сады Сен-Мартен', text: 'Тропинки над морем, скамейки в тени. Отличное место для перерыва.', scene: 'garden', hour: 12 },
  { at: [7.4200, 43.7311], cat: 'photo', title: 'Смотровая у дворца', text: 'Отсюда видно всю бухту. Приходить на закате!', scene: 'sunset', hour: 6 },
  { at: [7.4300, 43.7440], cat: 'food', title: 'Кафе у пляжа Ларвотто', text: 'Круассан и капучино с видом на волны. Цены — по-монакски.', scene: 'cafe', hour: 9 },
  { at: [7.4198, 43.7336], cat: 'transport', title: 'Вокзал Монако', text: 'Поезда в Ниццу каждые 15 минут. Выход к порту — налево, через лифт.', scene: 'street', hour: 14 },
  { at: [7.4177, 43.7286], cat: 'stay', title: 'Отель в Фонвьей', text: 'Тихий район, бассейн на крыше. Забронировать заранее.', scene: 'harbor', hour: 23 },
  { at: [7.4225, 43.7345], cat: 'danger', title: 'Крутая лестница', text: 'Ступени скользкие после дождя. Держитесь за поручень.', scene: 'street', hour: 11 },
  { at: [7.4268, 43.7383], cat: 'idea', title: 'Вернуться на закате', text: 'Взять штатив и снять таймлапс над бухтой.', scene: 'sunset', hour: 17 },
];

type Scene = 'harbor' | 'casino' | 'garden' | 'sunset' | 'cafe' | 'street';

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const PAL: Record<Scene, { sky: [string, string]; sea: string; hill: string; accent: string }> = {
  harbor: { sky: ['#8fd3ff', '#e8f6ff'], sea: '#2a8fc9', hill: '#5e7f6a', accent: '#ffffff' },
  casino: { sky: ['#1b2450', '#f08a5d'], sea: '#1d3557', hill: '#2b2d42', accent: '#ffd166' },
  garden: { sky: ['#a8e0ff', '#f1fbff'], sea: '#3aa0d8', hill: '#3f8f5a', accent: '#ff7aa8' },
  sunset: { sky: ['#3a1c71', '#ffaf7b'], sea: '#d76d77', hill: '#2a1a4a', accent: '#fff3b0' },
  cafe: { sky: ['#bfe6ff', '#fff6e0'], sea: '#39a2db', hill: '#c9a36b', accent: '#7b4a2b' },
  street: { sky: ['#9ec5e8', '#f3ead8'], sea: '#6aa6c9', hill: '#b8a58a', accent: '#c1663f' },
};

async function makeScene(kind: Scene, seed: number): Promise<{ blob: Blob; thumb: Blob }> {
  const W = 1200;
  const H = 800;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed);
  const pal = PAL[kind];
  const sky = g.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(1, pal.sky[1]);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  // солнце
  const sun = g.createRadialGradient(W * (0.25 + r() * 0.5), H * 0.3, 0, W * 0.5, H * 0.3, 260);
  sun.addColorStop(0, 'rgba(255,255,240,0.95)');
  sun.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H);
  // холмы
  for (let k = 0; k < 3; k++) {
    g.fillStyle = k === 0 ? pal.hill + 'aa' : pal.hill;
    g.beginPath();
    g.moveTo(0, H * (0.5 + k * 0.05));
    for (let x = 0; x <= W; x += 60) g.lineTo(x, H * (0.42 + k * 0.06) + Math.sin(x / 140 + seed + k) * 46 + r() * 22);
    g.lineTo(W, H * 0.7);
    g.lineTo(0, H * 0.7);
    g.fill();
  }
  // море
  const sea = g.createLinearGradient(0, H * 0.58, 0, H);
  sea.addColorStop(0, pal.sea);
  sea.addColorStop(1, '#0d3b66');
  g.fillStyle = sea;
  g.fillRect(0, H * 0.62, W, H * 0.38);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const y = H * 0.64 + r() * H * 0.34;
    const x = r() * W;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 40 + r() * 90, y);
    g.stroke();
  }
  // здания / яхты / растения
  if (kind === 'casino' || kind === 'street' || kind === 'cafe') {
    for (let i = 0; i < 9; i++) {
      const bw = 90 + r() * 90;
      const bh = 140 + r() * 210;
      const x = i * 135 - 20;
      g.fillStyle = kind === 'casino' ? `hsl(${25 + r() * 20} 50% ${62 + r() * 12}%)` : `hsl(${30 + r() * 25} 45% ${68 + r() * 14}%)`;
      g.fillRect(x, H * 0.66 - bh, bw, bh);
      g.fillStyle = kind === 'casino' ? pal.accent : 'rgba(255,255,255,0.7)';
      for (let wy = H * 0.66 - bh + 18; wy < H * 0.66 - 24; wy += 34) for (let wx = x + 14; wx < x + bw - 16; wx += 26) g.fillRect(wx, wy, 12, 18);
    }
  }
  if (kind === 'harbor') {
    for (let i = 0; i < 7; i++) {
      const x = 80 + i * 160 + r() * 40;
      const y = H * 0.74 + r() * 90;
      g.fillStyle = '#f5f5f5';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 110, y);
      g.lineTo(x + 90, y + 24);
      g.lineTo(x + 14, y + 24);
      g.fill();
      g.fillStyle = '#e63946';
      g.fillRect(x + 50, y - 60, 5, 60);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(x + 55, y - 58);
      g.lineTo(x + 100, y - 6);
      g.lineTo(x + 55, y - 6);
      g.fill();
    }
  }
  if (kind === 'garden' || kind === 'sunset') {
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      const y = H * (0.7 + r() * 0.3);
      g.fillStyle = `hsl(${100 + r() * 40} 45% ${22 + r() * 18}%)`;
      g.beginPath();
      g.ellipse(x, y, 50 + r() * 70, 30 + r() * 46, 0, 0, Math.PI * 2);
      g.fill();
      if (r() > 0.55) {
        g.fillStyle = pal.accent;
        g.beginPath();
        g.arc(x + r() * 40 - 20, y - 10 - r() * 20, 6 + r() * 5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  if (kind === 'cafe') {
    g.fillStyle = '#5b3a29';
    g.fillRect(0, H * 0.8, W, H * 0.2);
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(W * 0.5, H * 0.86, 150, 44, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7b4a2b';
    g.beginPath();
    g.ellipse(W * 0.5, H * 0.855, 105, 26, 0, 0, Math.PI * 2);
    g.fill();
  }
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.9);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = vg;
  g.fillRect(0, 0, W, H);
  const toBlob = (cv: HTMLCanvasElement, q: number) => new Promise<Blob>((res) => cv.toBlob((b) => res(b!), 'image/jpeg', q));
  const t = document.createElement('canvas');
  t.width = 360;
  t.height = 240;
  t.getContext('2d')!.drawImage(c, 0, 0, 360, 240);
  return { blob: await toBlob(c, 0.85), thumb: await toBlob(t, 0.8) };
}

async function makeVideo(): Promise<{ blob: Blob; thumb: Blob } | null> {
  try {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = 320;
    const g = c.getContext('2d')!;
    const stream = c.captureStream(20);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((res) => (rec.onstop = () => res()));
    rec.start();
    const t0 = performance.now();
    await new Promise<void>((res) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        const grad = g.createLinearGradient(0, 0, 480, 320);
        grad.addColorStop(0, `hsl(${200 + t * 40} 70% 45%)`);
        grad.addColorStop(1, `hsl(${260 + t * 40} 70% 35%)`);
        g.fillStyle = grad;
        g.fillRect(0, 0, 480, 320);
        g.fillStyle = 'rgba(255,255,255,0.85)';
        g.beginPath();
        g.arc(240 + Math.cos(t * 3) * 120, 160 + Math.sin(t * 3) * 60, 30, 0, Math.PI * 2);
        g.fill();
        if (t < 1.2) requestAnimationFrame(tick);
        else res();
      };
      tick();
    });
    rec.stop();
    await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const thumb = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.8));
    return { blob, thumb };
  } catch {
    return null;
  }
}

function nearestIndex(p: P): number {
  let best = 0;
  let bd = Infinity;
  ROUTE.forEach((q, i) => {
    const d = haversine({ lng: p[0], lat: p[1] }, { lng: q[0], lat: q[1] });
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Проигрывает [from, to) маршрута как GPS-фиксы, оканчивающиеся в момент endT. */
function play(from: number, to: number, endT: number): void {
  const step = 8 / 1.4; // 8 м при 1.4 м/с
  const n = to - from;
  for (let i = from; i < to; i++) {
    const t = endT - (to - 1 - i) * step * 1000;
    engine.onFix({ lng: ROUTE[i][0], lat: ROUTE[i][1], accuracy: 6, heading: null, speed: 1.4, t });
  }
  void n;
}

export async function seedDemo(): Promise<void> {
  engine.quiet = true;
  await engine.resetAll();
  const prefs = usePrefs.getState();
  prefs.set({ onboarded: true, completed: {}, zones: [] });

  const plan: [number, number][] = [[13, 40], [12, 55], [11, 45], [9, 60], [8, 70], [7, 50], [6, 55], [5, 45], [3, 35], [2, 50], [1, 35]];
  const now = Date.now();
  let idx = 0;
  for (const [ago, count] of plan) {
    const d = new Date(now - ago * DAY);
    d.setHours(10, 30, 0, 0);
    engine.resetAnchor();
    play(idx, idx + count, d.getTime() + count * 5700);
    idx += count;
  }
  // сегодня — оставшаяся часть маршрута
  engine.resetAnchor();
  const last = ROUTE.length;
  play(idx, last, now - 45000);

  // заметки в реальных местах маршрута
  const vid = await makeVideo();
  let k = 0;
  for (const lm of LANDMARKS) {
    const i = nearestIndex(lm.at);
    const day = Math.max(0, [12, 10, 9, 7, 5, 3, 2, 1, 0][k % 9]);
    const t = new Date(now - day * DAY);
    t.setHours(lm.hour, 12 + k * 4, 0, 0);
    const id = uid();
    const img = await makeScene(lm.scene, 11 + k * 7);
    const mediaIds: string[] = [];
    const mk = async (kind: 'photo' | 'video', blob: Blob, thumb: Blob, mime: string) => {
      const mid = uid();
      await putMedia({ id: mid, noteId: id, kind, mime, blob, thumb, size: blob.size, createdAt: t.getTime(), width: 1200, height: 800 });
      mediaIds.push(mid);
    };
    await mk('photo', img.blob, img.thumb, 'image/jpeg');
    if (k % 3 === 0) {
      const img2 = await makeScene(lm.scene === 'harbor' ? 'sunset' : 'harbor', 91 + k);
      await mk('photo', img2.blob, img2.thumb, 'image/jpeg');
    }
    let videos = 0;
    if (k === 1 && vid) {
      await mk('video', vid.blob, vid.thumb, 'video/webm');
      videos = 1;
    }
    const note: Note = {
      id,
      title: lm.title,
      text: lm.text,
      category: lm.cat,
      lng: ROUTE[i][0],
      lat: ROUTE[i][1],
      createdAt: Math.min(t.getTime(), now - 60000),
      updatedAt: t.getTime(),
      mediaIds,
      photos: mediaIds.length - videos,
      videos,
    };
    await engine.insertNote(note);
    k++;
  }

  await engine.flush();
  await engine.reloadFromDb();
  engine.quiet = false;

  const app = useApp.getState();
  const p = ROUTE[last - 1];
  app.patch({
    position: { lng: p[0], lat: p[1], accuracy: 6, heading: 62, speed: 1.3, t: now },
    gps: 'ok',
    heading: 62,
    compassAvailable: true,
    follow: true,
    flyTo: { lng: p[0], lat: p[1], zoom: 15.6, nonce: Date.now() },
  });
}

const tom = { engine, useApp, usePrefs, seedDemo, route: ROUTE };
(window as unknown as { __tom: typeof tom }).__tom = tom;
