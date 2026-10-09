import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet, Switch } from '../common';
import { importMapFile, loadCatalog, removeMap, type CatalogEntry } from '../../map/maps';
import { activateMap, refreshMapSources } from '../../state/actions';
import { pickFile } from '../../services/files';
import { deleteSavedArea, hereJob, requestDownload, setOnlineMaps, worldJob } from '../../state/downloads';
import { tileCache, type CacheStats } from '../../map/tilecache';
import { fmtBytes } from '../format';
import { WORLD_ID } from '../../state/downloads';

/** Карты: онлайн-режим и кэш, сохранённые области, файлы .pmtiles. */
export function MapsSheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const active = usePrefs((s) => s.activeMapId);
  const online = usePrefs((s) => s.onlineMaps);
  const askArea = usePrefs((s) => s.askAreaPrompts);
  const saved = usePrefs((s) => s.savedAreas);
  const limitMb = usePrefs((s) => s.cacheLimitMb);
  // положение меняется каждую секунду, а оценка размера нужна только при заметном сдвиге (≈ 10 км)
  const hereKey = useApp((s) => (s.position ? `${s.position.lat.toFixed(1)},${s.position.lng.toFixed(1)}` : ''));
  const hereEstimate = useMemo(() => {
    const p = useApp.getState().position;
    return hereKey && p ? hereJob(p, false).job.estimate : null;
  }, [hereKey]);
  const position = hereKey !== '';
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<CacheStats | null>(null);

  const refresh = () => void loadCatalog().then(setItems);
  const refreshStats = () => void tileCache.stats().then(setStats);
  useEffect(() => {
    refresh();
    refreshStats();
  }, []);

  const doImport = async () => {
    const f = await pickFile('.pmtiles,application/octet-stream');
    if (!f) return;
    setBusy(true);
    try {
      const rec = await importMapFile(f);
      refresh();
      await activateMap(rec.id);
      useApp.getState().toast({ kind: 'info', title: t('maps.imported'), text: rec.name, icon: 'check' });
    } catch (e) {
      useApp.getState().toast({ kind: 'error', title: t('maps.import_failed'), text: (e as Error).message === 'not-vector' ? t('maps.not_vector') : t('maps.not_pmtiles') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await removeMap(id);
    if (id === active) {
      const first = (await loadCatalog())[0];
      if (first) await activateMap(first.id);
    }
    await refreshMapSources();
    refresh();
  };

  const hasWorld = saved.some((a) => a.id === WORLD_ID);

  return (
    <Sheet tall title={t('maps.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <p className="muted">{t('maps.intro')}</p>

        <div className="card source-card">
          <div className="set-row">
            <span>
              <Icon name="globe" size={18} /> {t('maps.online')}
            </span>
            <Switch checked={online} onChange={setOnlineMaps} label={t('maps.online')} />
          </div>
          <small className="muted">{t('maps.online_hint')}</small>
          <button className="btn ghost block" onClick={() => patch({ sheet: { type: 'layers' } })}>
            <Icon name="layers" size={18} /> {t('layers.title')}
          </button>
          <div className="set-row">
            <span>
              <Icon name="download" size={18} /> {t('maps.ask_area')}
            </span>
            <Switch checked={askArea} onChange={(v) => usePrefs.getState().set({ askAreaPrompts: v })} label={t('maps.ask_area')} />
          </div>
          <small className="muted">{t('maps.ask_area_hint')}</small>
        </div>

        <h4 className="sect-sm">{t('maps.saved_title')}</h4>
        {saved.length === 0 ? (
          <p className="muted">{t('maps.saved_none')}</p>
        ) : (
          <div className="card list">
            {saved.map((a) => (
              <div key={a.id} className="map-item">
                <span className="mi-radio on"><Icon name="check" size={14} strokeWidth={3.2} /></span>
                <div className="mi-main static">
                  <span>
                    <b>{a.flag ? `${a.flag} ` : ''}{a.name}</b>
                    <small>z ≤ {a.maxZoom} · {a.tiles.toLocaleString()} {t('countries.tiles')}{a.dem ? ` · ${t('layers.elevation')}` : ''}</small>
                  </span>
                </div>
                <button className="icon-btn" aria-label={t('note.show')} onClick={() => patch({ sheet: null, screen: 'map', fitBounds: { bounds: a.bbox, nonce: Date.now() } })}>
                  <Icon name="map" size={18} />
                </button>
                <button className="icon-btn danger-text" aria-label={t('common.delete')} onClick={() => void deleteSavedArea(a.id).then(refreshStats)}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
        {position && hereEstimate !== null && (
          <button className="btn primary block" onClick={() => useApp.getState().position && requestDownload(hereJob(useApp.getState().position!).job)}>
            <Icon name="locate" size={18} /> {t('here.save')} · ≈ {fmtBytes(hereEstimate)}
          </button>
        )}
        {!hasWorld && (
          <button className="btn ghost block" onClick={() => requestDownload(worldJob())}>
            <Icon name="globe" size={18} /> {t('world.name')} · ≈ {fmtBytes(worldJob().estimate)}
          </button>
        )}
        <button className="btn primary block" onClick={() => patch({ sheet: { type: 'countries' } })}>
          <Icon name="download" size={18} /> {t('countries.choose')}
        </button>

        <h4 className="sect-sm">{t('maps.cache')}</h4>
        <div className="card source-card">
          <div className="slider-row">
            <span>{t('maps.cache_limit')}</span>
            <b>{limitMb} {t('unit.mb')}</b>
          </div>
          <input
            type="range"
            min={100}
            max={2000}
            step={100}
            value={limitMb}
            aria-label={t('maps.cache_limit')}
            onChange={(e) => {
              const mb = Number(e.target.value);
              usePrefs.getState().set({ cacheLimitMb: mb });
              tileCache.setLimit(mb * 1024 * 1024);
            }}
          />
          {stats && (
            <small className="muted">
              {t('maps.cache_used', { used: fmtBytes(stats.bytes), limit: `${limitMb} MB` })}
              {stats.pinnedBytes ? ` · ${t('maps.cache_pinned', { size: fmtBytes(stats.pinnedBytes) })}` : ''}
            </small>
          )}
          <button className="btn ghost sm" onClick={() => void tileCache.clear().then(refreshStats)}>
            <Icon name="trash" size={14} /> {t('maps.cache_clear')}
          </button>
        </div>

        <h4 className="sect-sm">{t('maps.files_title')}</h4>
        <div className="card list">
          {items.map((m) => (
            <div key={m.id} className={`map-item ${m.id === active ? 'on' : ''}`}>
              <button className="mi-main" onClick={() => void activateMap(m.id)}>
                <span className="mi-radio">{m.id === active && <Icon name="check" size={14} strokeWidth={3.2} />}</span>
                <span>
                  <b>{m.name}</b>
                  <small>
                    {m.source === 'bundled' ? t('maps.bundled') : `${((m.size ?? 0) / 1e6).toFixed(1)} ${t('unit.mb')}`}
                    {m.minzoom !== undefined ? ` · z${m.minzoom}–${m.maxzoom}` : ''}
                  </small>
                </span>
              </button>
              {m.bounds && (
                <button className="icon-btn" aria-label={t('note.show')} onClick={() => patch({ sheet: null, screen: 'map', fitBounds: { bounds: m.bounds!, nonce: Date.now() } })}>
                  <Icon name="map" size={18} />
                </button>
              )}
              {m.source === 'imported' && (
                <button className="icon-btn danger-text" aria-label={t('common.delete')} onClick={() => void remove(m.id)}>
                  <Icon name="trash" size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
        <button className="btn ghost block" disabled={busy} onClick={() => void doImport()}>
          <Icon name="upload" size={18} /> {busy ? t('common.loading') : t('maps.import')}
        </button>
      </div>
    </Sheet>
  );
}
