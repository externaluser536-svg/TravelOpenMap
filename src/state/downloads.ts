// Загрузка карт (обзор мира, страна, область) через изолированный сетевой шлюз.
// Без разрешения пользователя ничего не скачивается: любая загрузка начинается с явного согласия.

import { DETAIL_PRESETS, type Country, type DetailId, countryName } from '../data/countries';
import { WORLD_BBOX, WORLD_MAX_ZOOM, type AreaPlan, planTitle } from '../core/regions';
import { estimateBytes } from '../map/extract';
import { downloadRegion, GatewayError, probeSource } from '../map/gateway-client';
import { importMapFile, loadCatalog, removeMap, WORLD_CODE } from '../map/maps';
import { activateMap, refreshMapSources } from './actions';
import { usePrefs } from './prefs';
import { useApp, type DownloadJob } from './store';
import { success } from '../services/haptics';
import { t } from '../i18n';

/** Потолок объёма тайлов в памяти при загрузке, байт. */
export const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

/** Сколько последних ежедневных сборок Protomaps перебираем при автоподборе источника. */
const SOURCE_LOOKBACK_DAYS = 5;
const SOURCE_TTL_MS = 20 * 3600 * 1000;

let abort: AbortController | null = null;

/** Главный выключатель: разрешена ли работа с сетью для загрузки карт. */
export function downloadsEnabled(): boolean {
  return usePrefs.getState().allowDownloads;
}

export function cancelDownload(): void {
  abort?.abort();
}

const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

/** Адрес источника: заданный вручную или последняя доступная ежедневная сборка Protomaps. */
export async function resolveSourceUrl(): Promise<string> {
  const p = usePrefs.getState();
  const custom = p.mapSourceUrl.trim();
  if (custom) return custom;
  if (p.resolvedSource && Date.now() - p.resolvedSource.at < SOURCE_TTL_MS) return p.resolvedSource.url;
  for (let back = 0; back < SOURCE_LOOKBACK_DAYS; back++) {
    const url = `https://build.protomaps.com/${ymd(new Date(Date.now() - back * 86400000))}.pmtiles`;
    try {
      await probeSource(url);
      usePrefs.getState().set({ resolvedSource: { url, at: Date.now() } });
      return url;
    } catch (e) {
      if (e instanceof GatewayError && e.code === 'aborted') throw e;
      /* сборки за этот день нет или недоступна — пробуем предыдущий */
    }
  }
  throw new GatewayError('network', 'no-source');
}

export const worldJob = (): DownloadJob => ({
  id: WORLD_CODE,
  name: t('world.name'),
  flag: '🌍',
  bbox: WORLD_BBOX,
  maxZoom: WORLD_MAX_ZOOM,
  country: WORLD_CODE,
  estimate: estimateBytes(WORLD_BBOX, 0, WORLD_MAX_ZOOM),
  activate: false,
});

export function countryJob(c: Country, detail: DetailId): DownloadJob {
  const maxZoom = DETAIL_PRESETS.find((d) => d.id === detail)!.maxZoom;
  return {
    id: c.code,
    name: countryName(c, usePrefs.getState().lang),
    flag: c.flag,
    bbox: c.bbox,
    maxZoom,
    country: c.code,
    estimate: estimateBytes(c.bbox, 0, maxZoom),
    activate: true,
  };
}

export function areaJob(plan: AreaPlan, at: { lng: number; lat: number }): DownloadJob {
  return {
    id: plan.key,
    name: planTitle(plan, usePrefs.getState().lang, at),
    flag: plan.country.flag,
    bbox: plan.bbox,
    maxZoom: plan.maxZoom,
    // область не помечает страну как «карта есть»
    country: plan.whole ? plan.country.code : '',
    estimate: plan.estimate,
    activate: true,
  };
}

/** Загрузка по запросу пользователя: если сеть ещё не разрешена — сначала спрашиваем согласие. */
export function requestDownload(job: DownloadJob): void {
  const app = useApp.getState();
  if (app.download?.state === 'running') return;
  if (!downloadsEnabled()) {
    app.patch({ downloadPrompt: { kind: 'consent', job } });
    return;
  }
  void startDownload(job);
}

/** Пользователь согласился: разрешаем сеть для загрузки карт и качаем. */
export function acceptDownload(job: DownloadJob): void {
  usePrefs.getState().set({ allowDownloads: true });
  useApp.getState().patch({ downloadPrompt: null });
  void startDownload(job);
}

/** Пользователь отказался от вопроса про обзор мира. */
export function declineWorld(): void {
  usePrefs.getState().set({ worldPrompted: true });
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

/** Старые карты той же области с меньшей детализацией больше не нужны. */
async function dropSuperseded(newId: string, job: DownloadJob): Promise<void> {
  const [w, s, e, n] = job.bbox;
  for (const m of await loadCatalog()) {
    if (m.source !== 'imported' || m.id === newId || !m.bounds || m.maxzoom === undefined) continue;
    const [mw, ms, me, mn] = m.bounds;
    const covered = mw >= w - 1e-6 && ms >= s - 1e-6 && me <= e + 1e-6 && mn <= n + 1e-6;
    if (covered && m.maxzoom <= job.maxZoom) await removeMap(m.id);
  }
}

export async function startDownload(job: DownloadJob): Promise<void> {
  const app = useApp.getState();
  if (!downloadsEnabled() || app.download?.state === 'running') return;
  abort = new AbortController();
  const label = `${job.flag ? `${job.flag} ` : ''}${job.name}`;
  app.patch({ download: { code: job.id, name: job.name, state: 'running' }, downloadPrompt: null });
  try {
    const url = await resolveSourceUrl();
    const out = await downloadRegion({
      url,
      bbox: job.bbox,
      maxZoom: job.maxZoom,
      name: `${job.name} z≤${job.maxZoom}`,
      maxBytes: MAX_DOWNLOAD_BYTES,
      signal: abort.signal,
      onProgress: (progress) => useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'running', progress } }),
    });
    const rec = await importMapFile(new File([out.blob], `${job.id.replace(/[^\w-]/g, '_')}-z${job.maxZoom}.pmtiles`), {
      name: `${label} · z≤${job.maxZoom}`,
      country: job.country || undefined,
    });
    await dropSuperseded(rec.id, job);
    if (job.country === WORLD_CODE) usePrefs.getState().set({ worldPrompted: true });
    useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'done' } });
    useApp.getState().toast({ kind: 'info', title: t('countries.downloaded'), text: `${job.name} · ${(out.blob.size / 1e6).toFixed(1)} ${t('unit.mb')}`, icon: 'check' });
    success();
    if (job.activate) await activateMap(rec.id);
    else await refreshMapSources();
  } catch (e) {
    const code = e instanceof GatewayError ? e.code : 'network';
    if (code === 'aborted') {
      useApp.getState().patch({ download: null });
      return;
    }
    useApp.getState().patch({ download: { code: job.id, name: job.name, state: 'error', error: t(`countries.err.${code}`) } });
  } finally {
    abort = null;
  }
}

/** Совместимость: загрузка страны по выбору детализации. */
export function startCountryDownload(c: Country, detail: DetailId): void {
  requestDownload(countryJob(c, detail));
}
