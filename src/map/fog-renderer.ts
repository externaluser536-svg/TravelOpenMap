// Отрисовка тумана поверх карты MapLibre.
//
// Два канваса над картой (pointer-events: none):
//  • fog  — сплошной туман; открытые ячейки «выбиваются» из него мягкими кистями
//           (маска в пониженном разрешении, потом масштабируется с билинейной
//           фильтрацией → плавные, «дымчатые» края);
//  • zone — исключённые зоны (штриховка + пунктир), всегда видны, даже в режиме «без тумана».
//
// Проекция ячеек считается вручную аффинным преобразованием, откалиброванным по
// map.project() — это на порядок быстрее, чем проецировать каждую ячейку через MapLibre,
// и корректно учитывает поворот карты.

import type { Map as MlMap } from 'maplibre-gl';
import { CELLS_PER_AXIS, type ExclusionZone, type FogGrid } from '../core/fog';
import { EQUATOR_M, latToY, lngToX, xToLng, yToLat } from '../core/geo';

/** Выделение области при ручной правке тумана (рисуется поверх тумана). */
export interface DraftShape {
  kind: 'circle' | 'poly' | 'stroke';
  action: 'open' | 'close';
  lng?: number;
  lat?: number;
  radius?: number;
  points?: { lng: number; lat: number }[];
  /** для кисти: радиус в пикселях экрана */
  radiusPx?: number;
}

export interface FogOptions {
  getDraftShape?: () => DraftShape | null;
  getZones: () => ExclusionZone[];
  getDraftZone: () => ExclusionZone | null;
  getOpacity: () => number;
  getTheme: () => 'light' | 'dark';
  /** Сила ветра: 0 — туман неподвижен, 1 — лёгкий, 2 — сильный. */
  getWind: () => number;
  /** false — туман не виден (другой экран, режим «без тумана»): анимацию можно ставить на паузу. */
  isActive: () => boolean;
}

const MASK_SCALE = 0.5;
const PULSE_MS = 1100;
const FOG_RGB = { dark: '3,6,14', light: '14,22,42' };
const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Сглаженный порог по альфе маски: чёткая, но не «лесенкой» граница тумана. */
function makeLut(a: number, b: number): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / 255 - a) / (b - a)));
    lut[i] = Math.round(255 * t * t * (3 - 2 * t));
  }
  return lut;
}
const EDGE_LUT = makeLut(0.3, 0.7); // ближний план: кисти
const EDGE_LUT_FAR = makeLut(0.08, 0.42); // дальний план: тонкие тропы не должны рваться

function makeBrush(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  // Программный (CPU) канвас: маска тоже CPU-канвас, и копирование между ними обходится без GPU-readback.
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/**
 * Бесшовная текстура облаков: fBm из периодического value-noise.
 * cells — число ячеек решётки базовой октавы, octaves — число октав, gain — затухание октав.
 */
function makeCloud(seed: number, cells: number, octaves: number, gain: number, maxAlpha: number, contrast: number): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  let st = seed;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const lattices: { n: number; v: Float32Array }[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells * 2 ** o;
    const v = new Float32Array(n * n);
    for (let i = 0; i < v.length; i++) v[i] = rnd();
    lattices.push({ n, v });
  }
  const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10); // квинтическая: без «ромбов» на стыках
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let val = 0;
      let amp = 1;
      let norm = 0;
      for (const { n, v } of lattices) {
        const fx = (x / S) * n;
        const fy = (y / S) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const x1 = (x0 + 1) % n;
        const y1 = (y0 + 1) % n;
        const xa = x0 % n;
        const ya = y0 % n;
        const a = v[ya * n + xa] * (1 - tx) + v[ya * n + x1] * tx;
        const b = v[y1 * n + xa] * (1 - tx) + v[y1 * n + x1] * tx;
        val += (a * (1 - ty) + b * ty) * amp;
        norm += amp;
        amp *= gain;
      }
      val /= norm;
      // контраст вокруг середины → отдельные «клубы» и просветы
      const t = Math.min(1, Math.max(0, (val - 0.5) * contrast + 0.5));
      const i = (y * S + x) * 4;
      img.data[i] = 165;
      img.data[i + 1] = 185;
      img.data[i + 2] = 225;
      img.data[i + 3] = Math.round(255 * maxAlpha * t ** 1.35);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

function makeHatch(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,120,120,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-2, 18);
  g.lineTo(18, -2);
  g.moveTo(-2, 2);
  g.lineTo(2, -2);
  g.moveTo(14, 18);
  g.lineTo(18, 14);
  g.stroke();
  return c;
}

export class FogRenderer {
  readonly fog = document.createElement('canvas');
  readonly zone = document.createElement('canvas');
  private fctx = this.fog.getContext('2d')!;
  private zctx = this.zone.getContext('2d')!;
  private mask = document.createElement('canvas');
  private glow = document.createElement('canvas');
  private half = document.createElement('canvas');
  private gctx = this.glow.getContext('2d')!;
  private hctx = this.half.getContext('2d', { willReadFrequently: true })!;
  private mctx = this.mask.getContext('2d', { willReadFrequently: true })!;
  private brush = makeBrush();
  private cloudBig = makeCloud(1337, 3, 5, 0.52, 0.6, 1.9);
  private cloudFine = makeCloud(7331, 5, 5, 0.55, 0.5, 2.1);
  private hatch = makeHatch();
  private pulses = new Map<number, number>();
  private raf = 0;
  private destroyed = false;
  private maskDirty = true;
  private lastFrame = 0;
  private clock = 0; // накопленное «время ветра», с
  private offA = { x: 0, y: 0 };
  private offB = { x: 0, y: 0 };
  /** Накопленное смещение центра карты в экранных пикселях (не зависит от zoom — масштабирование не разгоняет облака). */
  readonly pan = { x: 0, y: 0 };
  private lastCenter: { x: number; y: number } | null = null;
  private view: { w: number; h: number; wx0: number; wy0: number; worldSize: number; zones: { x: number; y: number; r: number }[] } | null = null;
  private peek = false;
  private onRender = () => this.requestDraw();
  private onVisibility = () => this.requestDraw();

  constructor(
    private map: MlMap,
    private grid: FogGrid,
    private opts: FogOptions,
  ) {
    for (const c of [this.fog, this.zone]) {
      c.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    }
    this.fog.className = 'fog-canvas';
    this.zone.className = 'zone-canvas';
    const host = map.getCanvasContainer();
    host.appendChild(this.fog);
    host.appendChild(this.zone);
    map.on('render', this.onRender);
    map.on('resize', this.onRender);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.requestDraw();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.map.off('render', this.onRender);
    this.map.off('resize', this.onRender);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.fog.remove();
    this.zone.remove();
  }

  setPeek(peek: boolean): void {
    this.peek = peek;
    this.fog.style.opacity = peek ? '0' : '1';
    this.requestDraw();
  }

  /** Настройки/тема/экран изменились — пересобрать кадр. */
  refresh(): void {
    this.requestDraw();
  }

  addPulse(cells: number[]): void {
    const now = performance.now();
    for (const k of cells) this.pulses.set(k, now);
    this.requestDraw();
  }

  /** Карта или данные изменились: маску нужно пересчитать. */
  requestDraw(): void {
    this.maskDirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame((ts) => {
      this.raf = 0;
      this.frame(ts);
    });
  }

  private animating(): boolean {
    return this.opts.getWind() > 0 && !this.peek && !document.hidden && this.opts.isActive() && !REDUCED_MOTION;
  }

  private frame(ts: number): void {
    if (this.destroyed) return;
    const anim = this.animating();
    const dtMs = ts - this.lastFrame;
    // анимацию ограничиваем 30 к/с; пересчёт маски (движение карты) — без ограничения
    if (anim && !this.maskDirty && !this.pulses.size && dtMs < 32) {
      this.schedule();
      return;
    }
    this.lastFrame = ts;
    if (anim) this.advanceWind(Math.min(dtMs, 100) / 1000);
    if (this.maskDirty || this.pulses.size) this.rebuild();
    this.composite();
    if (anim || this.pulses.size) this.schedule();
  }

  /** Ветер: направление «плавает», скорость меняется порывами. Два слоя дрейфуют в разные стороны. */
  private advanceWind(dt: number): void {
    const k = this.opts.getWind();
    this.clock += dt;
    const t = this.clock;
    const base = 28 + 22 * Math.sin(t / 37) + 9 * Math.sin(t / 11.3); // град.
    const gust = 1 + 0.55 * Math.sin(t / 8.7) * Math.sin(t / 3.1 + 1) + 0.25 * Math.sin(t / 2.3);
    const speed = 17 * k * Math.max(0.25, gust); // px/с
    const a = (base * Math.PI) / 180;
    const b = ((base + 38 + 14 * Math.sin(t / 19)) * Math.PI) / 180;
    this.offA.x += Math.cos(a) * speed * dt;
    this.offA.y += Math.sin(a) * speed * dt;
    this.offB.x += Math.cos(b) * speed * 1.9 * dt;
    this.offB.y += Math.sin(b) * speed * 1.9 * dt;
  }

  private resize(w: number, h: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.fog.width !== Math.round(w) || this.fog.height !== Math.round(h)) {
      this.fog.width = Math.round(w);
      this.fog.height = Math.round(h);
      this.mask.width = Math.max(1, Math.round(w * MASK_SCALE));
      this.mask.height = Math.max(1, Math.round(h * MASK_SCALE));
      this.half.width = Math.max(1, Math.round(w * MASK_SCALE * 0.5));
      this.half.height = Math.max(1, Math.round(h * MASK_SCALE * 0.5));
      this.glow.width = Math.max(1, Math.round(w / 9));
      this.glow.height = Math.max(1, Math.round(h / 9));
    }
    if (this.zone.width !== Math.round(w * dpr) || this.zone.height !== Math.round(h * dpr)) {
      this.zone.width = Math.round(w * dpr);
      this.zone.height = Math.round(h * dpr);
    }
    return dpr;
  }

  /** Порог по альфе маски → плавная, но чёткая граница тумана. */
  private applyEdge(ctx: CanvasRenderingContext2D, w: number, h: number, lut: Uint8ClampedArray): void {
    const img = ctx.getImageData(0, 0, w, h);
    const px = img.data;
    for (let i = 3; i < px.length; i += 4) px[i] = lut[px[i]];
    ctx.putImageData(img, 0, 0);
  }

  /** Только для замеров производительности (dev/demo). */
  drawNow(): number {
    const t0 = performance.now();
    this.maskDirty = true;
    this.rebuild();
    this.composite();
    return performance.now() - t0;
  }

  /** Дорогая часть: проекция ячеек → маска; зоны. Выполняется только при изменении карты/данных. */
  private rebuild(): void {
    if (this.destroyed) return;
    const map = this.map;
    const el = map.getContainer();
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const dpr = this.resize(w, h);

    const center = map.getCenter();
    const zoom = map.getZoom();
    const worldSize = 512 * 2 ** zoom;
    const cellPx = worldSize / CELLS_PER_AXIS;
    const wx0 = lngToX(center.lng) * worldSize;
    const wy0 = latToY(center.lat) * worldSize;
    {
      // сдвиг центра в долях мира × текущий размер мира = сдвиг в экранных пикселях; при чистом масштабировании он равен нулю
      const cx = lngToX(center.lng);
      const cy = latToY(center.lat);
      if (this.lastCenter) {
        this.pan.x += (cx - this.lastCenter.x) * worldSize;
        this.pan.y += (cy - this.lastCenter.y) * worldSize;
      }
      this.lastCenter = { x: cx, y: cy };
    }

    // Аффинное преобразование «мировые пиксели → экран», откалиброванное по MapLibre.
    const pA = map.project(center);
    const pB = map.project([xToLng((wx0 + 1000) / worldSize), center.lat]);
    const pC = map.project([center.lng, yToLat((wy0 + 1000) / worldSize)]);
    const a00 = (pB.x - pA.x) / 1000;
    const a10 = (pB.y - pA.y) / 1000;
    const a01 = (pC.x - pA.x) / 1000;
    const a11 = (pC.y - pA.y) / 1000;
    const sx = (xw: number, yw: number) => pA.x + a00 * (xw - wx0) + a01 * (yw - wy0);
    const sy = (xw: number, yw: number) => pA.y + a10 * (xw - wx0) + a11 * (yw - wy0);

    this.buildMask({ w, h, cellPx, wx0, wy0, worldSize, sx, sy, map });
    this.drawZones({ w, h, dpr, worldSize, sx, sy });
    this.drawShape({ worldSize, sx, sy });
    this.view = { w, h, wx0, wy0, worldSize, zones: this.allZones().map((z) => this.zoneScreen(z, { worldSize, sx, sy })) };
    this.maskDirty = false;
  }

  private buildMask(v: {
    w: number;
    h: number;
    cellPx: number;
    wx0: number;
    wy0: number;
    worldSize: number;
    sx: (x: number, y: number) => number;
    sy: (x: number, y: number) => number;
    map: MlMap;
  }): void {
    const { w, h, cellPx, worldSize, sx, sy, map } = v;
    const mw = this.mask.width;
    const mh = this.mask.height;
    const mctx = this.mctx;
    mctx.globalCompositeOperation = 'source-over';
    mctx.globalAlpha = 1;
    mctx.clearRect(0, 0, mw, mh);

    // Видимый прямоугольник в координатах ячеек (по четырём углам экрана).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
      const ll = map.unproject([px, py]);
      const cx = lngToX(ll.lng) * CELLS_PER_AXIS;
      const cy = latToY(ll.lat) * CELLS_PER_AXIS;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }

    const now = performance.now();
    const cellsW = (maxX - minX) * (maxY - minY);
    const pixelMode = cellPx < 9 || cellsW > 60000;
    const toWorld = worldSize / CELLS_PER_AXIS;
    const expired: number[] = [];

    if (pixelMode) {
      // Дальний план: каждая ячейка — блок пикселей маски (быстро, без вызовов drawImage).
      const img = mctx.createImageData(mw, mh);
      const buf = new Uint32Array(img.data.buffer);
      const solid = 0xffffffff;
      const size = Math.max(2, Math.round(cellPx * MASK_SCALE));
      const off = size >> 1;
      this.grid.forEachInRect(minX, minY, maxX, maxY, (x, y) => {
        const px = Math.round(sx((x + 0.5) * toWorld, (y + 0.5) * toWorld) * MASK_SCALE) - off;
        const py = Math.round(sy((x + 0.5) * toWorld, (y + 0.5) * toWorld) * MASK_SCALE) - off;
        for (let dy = 0; dy < size; dy++) {
          const Y = py + dy;
          if (Y < 0 || Y >= mh) continue;
          for (let dx = 0; dx < size; dx++) {
            const X = px + dx;
            if (X >= 0 && X < mw) buf[Y * mw + X] = solid;
          }
        }
      });
      mctx.putImageData(img, 0, 0);
      // размытие «вниз-вверх» + порог: гладкий контур вместо лесенки
      const hc = this.hctx;
      hc.clearRect(0, 0, this.half.width, this.half.height);
      hc.drawImage(this.mask, 0, 0, mw, mh, 0, 0, this.half.width, this.half.height);
      mctx.clearRect(0, 0, mw, mh);
      mctx.drawImage(this.half, 0, 0, this.half.width, this.half.height, 0, 0, mw, mh);
      this.applyEdge(mctx, mw, mh, EDGE_LUT_FAR);
    } else {
      const r = cellPx * 1.12;
      const d = r * 2 * MASK_SCALE;
      this.grid.forEachInRect(minX, minY, maxX, maxY, (x, y) => {
        const cx = sx((x + 0.5) * toWorld, (y + 0.5) * toWorld);
        const cy = sy((x + 0.5) * toWorld, (y + 0.5) * toWorld);
        if (cx < -r || cy < -r || cx > w + r || cy > h + r) return;
        let alpha = 1;
        if (this.pulses.size) {
          const t0 = this.pulses.get(x * CELLS_PER_AXIS + y);
          if (t0 !== undefined) {
            const k = (now - t0) / PULSE_MS;
            if (k >= 1) expired.push(x * CELLS_PER_AXIS + y);
            else alpha = 1 - (1 - k) ** 3;
          }
        }
        mctx.globalAlpha = alpha;
        mctx.drawImage(this.brush, (cx - r) * MASK_SCALE, (cy - r) * MASK_SCALE, d, d);
      });
      mctx.globalAlpha = 1;
      this.applyEdge(mctx, mw, mh, EDGE_LUT);
    }
    for (const k of expired) this.pulses.delete(k);
  }

  /** Дешёвая покадровая часть: заливка, движущиеся облака, вырез по маске, свечение. */
  private composite(): void {
    const view = this.view;
    if (!view) return;
    const { w, h } = view;
    const mw = this.mask.width;
    const mh = this.mask.height;
    const g = this.fctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    const opacity = this.opts.getOpacity();
    const rgb = FOG_RGB[this.opts.getTheme()];
    g.fillStyle = `rgba(${rgb},${opacity})`;
    g.fillRect(0, 0, w, h);
    // Два слоя облаков: крупные плывут по ветру, мелкие «нити» — быстрее и под углом.
    // Слагаемое от положения карты даёт параллакс: при движении по карте туман «остаётся на месте».
    const layers: [HTMLCanvasElement, { x: number; y: number }, number, number, number][] = [
      [this.cloudBig, this.offA, 2.4, 0.6, 0.95],
      [this.cloudFine, this.offB, 1.5, 0.85, 0.8],
    ];
    for (const [tex, off, scale, parallax, alpha] of layers) {
      const pat = g.createPattern(tex, 'repeat');
      if (!pat) continue;
      const S = 256 * scale;
      const ox = (((off.x - this.pan.x * parallax) % S) + S) % S;
      const oy = (((off.y - this.pan.y * parallax) % S) + S) % S;
      pat.setTransform(new DOMMatrix().translate(ox - S, oy - S).scale(scale));
      g.globalAlpha = alpha;
      g.fillStyle = pat;
      g.fillRect(0, 0, w, h);
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'destination-out';
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(this.mask, 0, 0, mw, mh, 0, 0, w, h);

    // Мягкое свечение границы: размытая копия маски, окрашенная в акцентный цвет,
    // кладётся только поверх тумана (source-atop) и «подсвечивает» край открытой области.
    const gl = this.gctx;
    gl.globalCompositeOperation = 'source-over';
    gl.clearRect(0, 0, this.glow.width, this.glow.height);
    gl.imageSmoothingQuality = 'high';
    gl.drawImage(this.mask, 0, 0, mw, mh, 0, 0, this.glow.width, this.glow.height);
    gl.globalCompositeOperation = 'source-in';
    gl.fillStyle = 'rgb(61,220,151)';
    gl.fillRect(0, 0, this.glow.width, this.glow.height);
    g.globalCompositeOperation = 'source-atop';
    // свечение слегка «дышит» вместе с порывами ветра
    g.globalAlpha = 0.36 + (this.opts.getWind() > 0 ? 0.08 * Math.sin(this.clock * 1.3) : 0.06);
    g.drawImage(this.glow, 0, 0, this.glow.width, this.glow.height, 0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Исключённые зоны снова закрываем туманом, даже если внутри что-то было открыто.
    for (const c of view.zones) {
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fillStyle = `rgba(${rgb},${Math.min(1, opacity + 0.05)})`;
      g.fill();
    }
  }

  private allZones(): ExclusionZone[] {
    const z = this.opts.getZones();
    const d = this.opts.getDraftZone();
    return d ? [...z, d] : z;
  }

  private zoneScreen(
    z: ExclusionZone,
    v: { worldSize: number; sx: (x: number, y: number) => number; sy: (x: number, y: number) => number },
  ): { x: number; y: number; r: number } {
    const wx = lngToX(z.lng) * v.worldSize;
    const wy = latToY(z.lat) * v.worldSize;
    const mPerWorldPx = (EQUATOR_M * Math.cos((z.lat * Math.PI) / 180)) / v.worldSize;
    return { x: v.sx(wx, wy), y: v.sy(wx, wy), r: z.radius / mPerWorldPx };
  }

  private drawShape(v: {
    worldSize: number;
    sx: (x: number, y: number) => number;
    sy: (x: number, y: number) => number;
  }): void {
    const shape = this.opts.getDraftShape?.();
    if (!shape) return;
    const g = this.zctx;
    const open = shape.action === 'open';
    const stroke = open ? 'rgba(46,230,166,0.98)' : 'rgba(255,107,129,0.98)';
    const fill = open ? 'rgba(46,230,166,0.20)' : 'rgba(255,107,129,0.22)';
    g.save();
    g.beginPath();
    let anchors: { x: number; y: number }[] = [];
    if (shape.kind === 'stroke') {
      // мазок кисти: один контур с круглыми концами, поэтому пересечения не темнеют
      const pts = (shape.points ?? []).map((p) => {
        const wx = lngToX(p.lng) * v.worldSize;
        const wy = latToY(p.lat) * v.worldSize;
        return { x: v.sx(wx, wy), y: v.sy(wx, wy) };
      });
      if (pts.length) {
        const r = shape.radiusPx ?? 24;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.lineWidth = r * 2;
        g.strokeStyle = fill.replace(/[\d.]+\)$/, open ? '0.42)' : '0.46)');
        pts.forEach((a, i) => (i ? g.lineTo(a.x, a.y) : g.moveTo(a.x, a.y)));
        if (pts.length === 1) g.lineTo(pts[0].x + 0.01, pts[0].y);
        g.stroke();
      }
      g.restore();
      return;
    }
    if (shape.kind === 'circle' && shape.lng !== undefined && shape.lat !== undefined && shape.radius) {
      const c = this.zoneScreen({ id: 'shape', name: '', lng: shape.lng, lat: shape.lat, radius: shape.radius }, v);
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    } else if (shape.kind === 'poly' && shape.points?.length) {
      anchors = shape.points.map((p) => {
        const wx = lngToX(p.lng) * v.worldSize;
        const wy = latToY(p.lat) * v.worldSize;
        return { x: v.sx(wx, wy), y: v.sy(wx, wy) };
      });
      anchors.forEach((a, i) => (i ? g.lineTo(a.x, a.y) : g.moveTo(a.x, a.y)));
      if (anchors.length > 2) g.closePath();
    } else {
      g.restore();
      return;
    }
    if (shape.kind === 'circle' || anchors.length > 2) {
      g.fillStyle = fill;
      g.fill();
    }
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.setLineDash([9, 6]);
    g.strokeStyle = stroke;
    g.stroke();
    g.setLineDash([]);
    for (const a of anchors) {
      g.beginPath();
      g.arc(a.x, a.y, 6, 0, Math.PI * 2);
      g.fillStyle = '#fff';
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = stroke;
      g.stroke();
    }
    g.restore();
  }

  private drawZones(v: {
    w: number;
    h: number;
    dpr: number;
    worldSize: number;
    sx: (x: number, y: number) => number;
    sy: (x: number, y: number) => number;
  }): void {
    const g = this.zctx;
    g.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    g.clearRect(0, 0, v.w, v.h);
    const draft = this.opts.getDraftZone();
    const hatch = g.createPattern(this.hatch, 'repeat');
    for (const z of this.allZones()) {
      const c = this.zoneScreen(z, v);
      if (c.x + c.r < 0 || c.y + c.r < 0 || c.x - c.r > v.w || c.y - c.r > v.h) continue;
      g.beginPath();
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,90,90,0.10)';
      g.fill();
      if (hatch) {
        g.fillStyle = hatch;
        g.fill();
      }
      g.lineWidth = 2;
      g.setLineDash(z === draft ? [4, 6] : [10, 7]);
      g.strokeStyle = 'rgba(255,120,120,0.95)';
      g.stroke();
      g.setLineDash([]);
      if (c.r > 26) {
        g.font = '600 12px "Inter Variable", system-ui, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(9,14,27,0.85)';
        g.fillStyle = '#ffb4b4';
        g.strokeText(z.name, c.x, c.y);
        g.fillText(z.name, c.x, c.y);
      }
    }
  }
}
