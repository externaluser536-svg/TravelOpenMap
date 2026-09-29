// Загрузка карты страны через изолированный сетевой шлюз. Работает только при явном разрешении в настройках.

import { DETAIL_PRESETS, type Country, type DetailId, countryName } from '../data/countries';
import { downloadRegion, GatewayError } from '../map/gateway-client';
import { importMapFile } from '../map/maps';
import { activateMap } from './actions';
import { usePrefs } from './prefs';
import { useApp } from './store';
import { success } from '../services/haptics';
import { t } from '../i18n';

/** Потолок объёма тайлов в памяти при загрузке, байт. */
export const MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024;

let abort: AbortController | null = null;

export function downloadsEnabled(): boolean {
  const p = usePrefs.getState();
  return p.allowDownloads && /^https?:\/\//i.test(p.mapSourceUrl.trim());
}

export function cancelDownload(): void {
  abort?.abort();
}

export async function startCountryDownload(c: Country, detail: DetailId): Promise<void> {
  const app = useApp.getState();
  if (!downloadsEnabled() || app.download?.state === 'running') return;
  const preset = DETAIL_PRESETS.find((d) => d.id === detail)!;
  const lang = usePrefs.getState().lang;
  const name = countryName(c, lang);
  abort = new AbortController();
  app.patch({ download: { code: c.code, name, state: 'running' } });
  try {
    const out = await downloadRegion({
      url: usePrefs.getState().mapSourceUrl.trim(),
      bbox: c.bbox,
      maxZoom: preset.maxZoom,
      name: `${c.en} z≤${preset.maxZoom}`,
      maxBytes: MAX_DOWNLOAD_BYTES,
      signal: abort.signal,
      onProgress: (progress) => useApp.getState().patch({ download: { code: c.code, name, state: 'running', progress } }),
    });
    const rec = await importMapFile(new File([out.blob], `${c.code}-z${preset.maxZoom}.pmtiles`), { name: `${c.flag} ${name} · z≤${preset.maxZoom}`, country: c.code });
    useApp.getState().patch({ download: { code: c.code, name, state: 'done' } });
    useApp.getState().toast({ kind: 'info', title: t('countries.downloaded'), text: `${name} · ${(out.blob.size / 1e6).toFixed(1)} ${t('unit.mb')}`, icon: 'check' });
    success();
    await activateMap(rec.id);
  } catch (e) {
    const code = e instanceof GatewayError ? e.code : 'network';
    if (code === 'aborted') {
      useApp.getState().patch({ download: null });
      return;
    }
    useApp.getState().patch({ download: { code: c.code, name, state: 'error', error: t(`countries.err.${code}`) } });
  } finally {
    abort = null;
  }
}
