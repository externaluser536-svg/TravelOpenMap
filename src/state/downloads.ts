// Сохранение областей для офлайна и согласие на сеть.
// Без согласия (настройка «онлайн-карта») приложение не делает ни одного сетевого запроса.

import { DETAIL_PRESETS, type Country, type DetailId, countryName } from '../data/countries';
import { WORLD_BBOX, WORLD_MAX_ZOOM, type AreaPlan, planArea as planRegion, planTitle } from '../core/regions';
import { AreaError, OMT_MAX_ZOOM, planArea as planTiles, removeArea, saveArea, type AreaJob } from '../map/offline-areas';
import { usePrefs } from './prefs';
import { useApp, type DownloadJob } from './store';
import { success } from '../services/haptics';
import { t } from '../i18n';

let abort: AbortController | null = null;

export const WORLD_ID = 'WORLD';

export function onlineEnabled(): boolean {
  return usePrefs.getState().onlineMaps;
}

/** Включает или выключает онлайн-карту (сеть для тайлов). */
export function setOnlineMaps(on: boolean): void {
  usePrefs.getState().set({ onlineMaps: on, onlinePrompted: true });
}

export function cancelDownload(): void {
  abort?.abort();
}

export const worldJob = (): DownloadJob => ({
  id: WORLD_ID,
  name: t('world.name'),
  flag: '🌍',
  bbox: WORLD_BBOX,
  maxZoom: WORLD_MAX_ZOOM,
  dem: false,
  estimate: planTiles({ bbox: WORLD_BBOX, maxZoom: WORLD_MAX_ZOOM, dem: false }).estimate,
  fly: false,
});

export function countryJob(c: Country, detail: DetailId, dem = usePrefs.getState().mapLayers.elevation): DownloadJob {
  const maxZoom = DETAIL_PRESETS.find((d) => d.id === detail)!.maxZoom;
  return {
    id: `${c.code}:${detail}`,
    name: countryName(c, usePrefs.getState().lang),
    flag: c.flag,
    bbox: c.bbox,
    maxZoom,
    dem,
    estimate: planTiles({ bbox: c.bbox, maxZoom, dem }).estimate,
    fly: true,
  };
}

export function areaJob(plan: AreaPlan, at: { lng: number; lat: number }, dem = usePrefs.getState().mapLayers.elevation): DownloadJob {
  return {
    id: plan.key,
    name: planTitle(plan, usePrefs.getState().lang, at),
    flag: plan.country.flag,
    bbox: plan.bbox,
    maxZoom: plan.maxZoom,
    dem,
    estimate: planTiles({ bbox: plan.bbox, maxZoom: plan.maxZoom, dem }).estimate,
    fly: true,
  };
}

/** Карта вокруг указанного места (обычно — где вы сейчас): страна или область по плану, а вне каталога — квадрат ≈ 30 км. */
export function hereJob(at: { lng: number; lat: number }, dem = usePrefs.getState().mapLayers.elevation): { job: DownloadJob; key: string } {
  const plan = planRegion(at.lng, at.lat, 13);
  if (plan) return { job: areaJob(plan, at, dem), key: plan.key };
  const dLat = 0.15;
  const dLng = dLat / Math.max(0.2, Math.cos((at.lat * Math.PI) / 180));
  const bbox: [number, number, number, number] = [Math.max(-180, at.lng - dLng), Math.max(-85, at.lat - dLat), Math.min(180, at.lng + dLng), Math.min(85, at.lat + dLat)];
  const key = `here:${at.lat.toFixed(1)},${at.lng.toFixed(1)}`;
  return { key, job: { id: key, name: t('here.name'), bbox, maxZoom: 13, dem, estimate: planTiles({ bbox, maxZoom: 13, dem }).estimate, fly: false } };
}

/** Сохранение по запросу пользователя: если сеть ещё не разрешена — сначала спрашиваем согласие. */
export function requestDownload(job: DownloadJob): void {
  const app = useApp.getState();
  if (app.download?.state === 'running') return;
  if (!onlineEnabled()) {
    app.patch({ downloadPrompt: { kind: 'consent', job } });
    return;
  }
  void startDownload(job);
}

/** Пользователь согласился: включаем онлайн-карту и, если есть задание, сразу сохраняем область. */
export function acceptOnline(job?: DownloadJob): void {
  setOnlineMaps(true);
  useApp.getState().patch({ downloadPrompt: null });
  if (job) void startDownload(job);
}

/** Пользователь отказался от онлайн-карты при первом вопросе. */
export function declineOnline(): void {
  usePrefs.getState().set({ onlinePrompted: true });
  useApp.getState().patch({ downloadPrompt: null });
}

export function dismissAreaPrompt(forever: boolean): void {
  const p = useApp.getState().downloadPrompt;
  if (p?.kind === 'area' && forever) {
    const prefs = usePrefs.getState();
    prefs.set({ dismissedAreas: [...new Set([...prefs.dismissedAreas, p.dismissKey])] });
  }
  useApp.getState().patch({ downloadPrompt: null });
}

export async function startDownload(job: DownloadJob): Promise<void> {
  const app = useApp.getState();
  if (!onlineEnabled() || app.download?.state === 'running') return;
  abort = new AbortController();
  app.patch({ download: { code: job.id, name: job.name, state: 'running' }, downloadPrompt: null });
  const areaJob: AreaJob = { id: job.id, name: job.name, flag: job.flag, bbox: job.bbox, maxZoom: job.maxZoom, dem: job.dem };
  try {
    const area = await saveArea(areaJob, {
      signal: abort.signal,
      onProgress: (progress) => useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'running', progress } }),
    });
    useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'done' } });
    useApp.getState().toast({ kind: 'info', title: t('saved.done'), text: `${job.name} · ${area.tiles.toLocaleString()} ${t('countries.tiles')}`, icon: 'check' });
    success();
    if (job.fly) useApp.getState().patch({ fitBounds: { bounds: job.bbox, nonce: Date.now() } });
  } catch (e) {
    const code = e instanceof AreaError ? e.code : 'network';
    if (code === 'aborted') {
      useApp.getState().patch({ download: null });
      return;
    }
    useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'error', error: t(`saved.err.${code}`) } });
  } finally {
    abort = null;
  }
}

/** Совместимость: сохранение страны по выбору детализации. */
export function startCountryDownload(c: Country, detail: DetailId, dem?: boolean): void {
  requestDownload(countryJob(c, detail, dem));
}

export async function deleteSavedArea(id: string): Promise<void> {
  await removeArea(id);
}

export { OMT_MAX_ZOOM };
