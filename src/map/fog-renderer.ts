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

export interface FogOptions {
  getZones: () => ExclusionZone[];
  getDraftZone: () => ExclusionZone | null;
  getOpacity: () => number;
  getTheme: () => 'light' | 'dark';
}

const MASK_SCALE = 0.5;
const PULSE_MS = 1100;
const FOG_RGB = { dark: '3,6,14', light: '14,22,42' };

/** Сглаженный порог по альфе маски: чёткая, но не «лесенкой» граница тумана. */
const EDGE_LUT = (() => {
  const lut = new Uint8ClampedArray(256);
  const a = 0.3;
  const b = 0.7;
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / 255 - a) / (b - a)));
    lut[i] = Math.round(255 * t * t * (3 - 2 * t));
  }
  return lut;
})();

function makeBrush(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,1)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return c;
}

/** Бесшовная «облачная» текстура тумана. */
function makeCloud(): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  let seed = 1337;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 24 + rnd() * 60;
    const a = 0.07 + rnd() * 0.1;
    for (const dx of [-S, 0, S]) {
      for (const dy of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(160,180,220,${a})`);
        grad.addColorStop(1, 'rgba(160,180,220,0)');
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
  }
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
  private gctx = this.glow.getContext('2d')!;
  private mctx = this.mask.getContext('2d', { willReadFrequently: true })!;
  private brush = makeBrush();
  private cloud = makeCloud();
  private hatch = makeHatch();
  private pulses = new Map<number, number>();
  private raf = 0;
  private destroyed = false;
  private onRender = () => this.requestDraw();

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
    this.requestDraw();
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.map.off('render', this.onRender);
    this.map.off('resize', this.onRender);
    this.fog.remove();
    this.zone.remove();
  }

  setPeek(peek: boolean): void {
    this.fog.style.opacity = peek ? '0' : '1';
  }

  addPulse(cells: number[]): void {
    const now = performance.now();
    for (const k of cells) this.pulses.set(k, now);
    this.requestDraw();
  }

  requestDraw(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private resize(w: number, h: number): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.fog.width !== Math.round(w) || this.fog.height !== Math.round(h)) {
      this.fog.width = Math.round(w);
      this.fog.height = Math.round(h);
      this.mask.width = Math.max(1, Math.round(w * MASK_SCALE));
      this.mask.height = Math.max(1, Math.round(h * MASK_SCALE));
      this.glow.width = Math.max(1, Math.round(w / 9));
      this.glow.height = Math.max(1, Math.round(h / 9));
    }
    if (this.zone.width !== Math.round(w * dpr) || this.zone.height !== Math.round(h * dpr)) {
      this.zone.width = Math.round(w * dpr);
      this.zone.height = Math.round(h * dpr);
    }
    return dpr;
  }

  private draw(): void {
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

    this.drawFog({ w, h, cellPx, wx0, wy0, worldSize, sx, sy, map });
    this.drawZones({ w, h, dpr, worldSize, sx, sy });

    if (this.pulses.size) this.requestDraw();
  }

  private drawFog(v: {
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
    const pixelMode = cellPx * MASK_SCALE < 2.2 || cellsW > 60000;
    const toWorld = worldSize / CELLS_PER_AXIS;
    const expired: number[] = [];

    if (pixelMode) {
      const img = mctx.createImageData(mw, mh);
      const buf = new Uint32Array(img.data.buffer);
      const solid = 0xffffffff;
      const size = cellPx * MASK_SCALE >= 1.2 ? 2 : 1;
      this.grid.forEachInRect(minX, minY, maxX, maxY, (x, y) => {
        const px = Math.round(sx((x + 0.5) * toWorld, (y + 0.5) * toWorld) * MASK_SCALE);
        const py = Math.round(sy((x + 0.5) * toWorld, (y + 0.5) * toWorld) * MASK_SCALE);
        for (let dy = 0; dy < size; dy++) {
          for (let dx = 0; dx < size; dx++) {
            const X = px + dx;
            const Y = py + dy;
            if (X >= 0 && X < mw && Y >= 0 && Y < mh) buf[Y * mw + X] = solid;
          }
        }
      });
      mctx.putImageData(img, 0, 0);
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
      // порог по альфе → плавная, но чёткая граница
      const img = mctx.getImageData(0, 0, mw, mh);
      const px = img.data;
      for (let i = 3; i < px.length; i += 4) px[i] = EDGE_LUT[px[i]];
      mctx.putImageData(img, 0, 0);
    }
    for (const k of expired) this.pulses.delete(k);

    // Сам туман: заливка → облака → «вырезаем» открытые области маской.
    const g = this.fctx;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    const opacity = this.opts.getOpacity();
    const rgb = FOG_RGB[this.opts.getTheme()];
    g.fillStyle = `rgba(${rgb},${opacity})`;
    g.fillRect(0, 0, w, h);
    const pat = g.createPattern(this.cloud, 'repeat');
    if (pat) {
      g.save();
      g.globalAlpha = 0.55;
      g.translate(-(v.wx0 * 0.5) % 256, -(v.wy0 * 0.5) % 256);
      g.fillStyle = pat;
      g.fillRect(0, 0, w + 256, h + 256);
      g.restore();
    }
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
    g.globalAlpha = 0.42;
    g.drawImage(this.glow, 0, 0, this.glow.width, this.glow.height, 0, 0, w, h);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';

    // Исключённые зоны снова закрываем туманом, даже если внутри что-то было открыто.
    for (const z of this.allZones()) {
      const c = this.zoneScreen(z, v);
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
