// Обработка фото и видео перед сохранением: уменьшение, миниатюры.

import type { DraftMedia } from '../state/store';
import { uid } from '../data/db';

const MAX_PHOTO = 1920;
const THUMB = 360;

async function canvasToBlob(c: HTMLCanvasElement | OffscreenCanvas, type = 'image/jpeg', q = 0.82): Promise<Blob> {
  if ('convertToBlob' in c) return c.convertToBlob({ type, quality: q });
  return new Promise((res, rej) => (c as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), type, q));
}

function drawScaled(src: CanvasImageSource, sw: number, sh: number, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function processPhoto(file: Blob): Promise<DraftMedia> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const full = drawScaled(bmp, bmp.width, bmp.height, MAX_PHOTO);
  const thumb = drawScaled(full, full.width, full.height, THUMB);
  const out: DraftMedia = {
    key: uid(),
    kind: 'photo',
    blob: await canvasToBlob(full),
    thumb: await canvasToBlob(thumb, 'image/jpeg', 0.75),
    mime: 'image/jpeg',
    width: full.width,
    height: full.height,
  };
  bmp.close();
  return out;
}

export async function processVideo(file: Blob): Promise<DraftMedia> {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('video'));
    });
    try {
      v.currentTime = Math.min(0.3, (v.duration || 1) / 2);
      await new Promise<void>((res) => (v.onseeked = () => res()));
    } catch {
      /* без миниатюры */
    }
    const c = drawScaled(v, v.videoWidth || 640, v.videoHeight || 360, THUMB);
    return {
      key: uid(),
      kind: 'video',
      blob: file,
      thumb: await canvasToBlob(c, 'image/jpeg', 0.75),
      mime: file.type || 'video/mp4',
      width: v.videoWidth,
      height: v.videoHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function processFile(file: File): Promise<DraftMedia> {
  return file.type.startsWith('video/') ? processVideo(file) : processPhoto(file);
}

// Кэш object URL, чтобы не создавать их заново на каждый рендер.
const urlCache = new WeakMap<Blob, string>();
export function blobUrl(b: Blob): string {
  let u = urlCache.get(b);
  if (!u) {
    u = URL.createObjectURL(b);
    urlCache.set(b, u);
  }
  return u;
}
