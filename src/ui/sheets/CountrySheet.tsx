import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet, Switch } from '../common';
import { CountryPicker } from '../CountryPicker';
import { DETAIL_PRESETS, countryByCode, countryName, type DetailId } from '../../data/countries';
import { countTiles, estimateBytes } from '../../map/extract';
import { MAX_DOWNLOAD_BYTES, cancelDownload, downloadsEnabled, resolveSourceUrl, startCountryDownload } from '../../state/downloads';
import { loadCatalog, removeMap, type CatalogEntry } from '../../map/maps';
import { probeSource } from '../../map/gateway-client';
import { activateMap, refreshMapSources } from '../../state/actions';
import { importMapFile } from '../../map/maps';
import { pickFile } from '../../services/files';

/** Обзор стран: выбор страны для загрузки карты. */
export function CountriesSheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const [items, setItems] = useState<CatalogEntry[]>([]);
  useEffect(() => void loadCatalog().then(setItems), []);
  const have = new Set(items.map((i) => i.country).filter(Boolean));
  return (
    <Sheet tall title={t('countries.title')} onClose={() => patch({ sheet: null })} back={() => patch({ sheet: { type: 'maps' } })}>
      <CountryPicker
        onPick={(c) => patch({ sheet: { type: 'country', code: c.code } })}
        badge={(c) => (have.has(c.code) ? <span className="chip" style={{ ['--c' as string]: 'var(--s3)' }}><Icon name="check" size={11} strokeWidth={3} /> {t('countries.have')}</span> : null)}
      />
    </Sheet>
  );
}

const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} ${'GB'}` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

export function CountrySheet({ code }: { code: string }) {
  const { t, lang } = useT();
  const c = countryByCode(code);
  const patch = useApp((s) => s.patch);
  const dl = useApp((s) => s.download);
  const allow = usePrefs((s) => s.allowDownloads);
  const source = usePrefs((s) => s.mapSourceUrl);
  const [detail, setDetail] = useState<DetailId>('city');
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [probe, setProbe] = useState<{ state: 'idle' | 'busy' | 'ok' | 'err'; text?: string }>({ state: 'idle' });
  const [copied, setCopied] = useState(false);
  const refresh = () => void loadCatalog().then(setItems);
  useEffect(refresh, [dl?.state]);
  if (!c) return null;
  const mine = items.filter((i) => i.country === c.code);
  const preset = DETAIL_PRESETS.find((d) => d.id === detail)!;
  const running = dl?.state === 'running' && dl.code === c.code;
  const enabled = downloadsEnabled();
  const cmd = `pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles ${c.code.toLowerCase()}.pmtiles --bbox=${c.bbox.join(',')} --maxzoom=${preset.maxZoom}`;

  const check = async () => {
    setProbe({ state: 'busy' });
    try {
      const r = await probeSource(await resolveSourceUrl());
      setProbe({ state: 'ok', text: `${r.host} · z${r.header.minZoom}–${r.header.maxZoom}${r.name ? ` · ${r.name}` : ''}` });
    } catch {
      setProbe({ state: 'err', text: t('countries.probe_fail') });
    }
  };

  return (
    <Sheet tall title={<span className="country-title"><span className="flag big">{c.flag}</span>{countryName(c, lang)}</span>} onClose={() => patch({ sheet: null })} back={() => patch({ sheet: { type: 'countries' } })}>
      <div className="form">
        <p className="muted">{t(`region.${c.region}`)}{lang === 'en' && c.sub ? ` · ${c.sub}` : ''} · {c.area.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')} {t('unit.km2')}</p>

        {mine.length > 0 && (
          <div className="card list">
            {mine.map((m) => (
              <div key={m.id} className="map-item">
                <span className="mi-radio on"><Icon name="check" size={14} strokeWidth={3.2} /></span>
                <div className="mi-main static"><span><b>{m.name}</b><small>{((m.size ?? 0) / 1e6).toFixed(1)} {t('unit.mb')}</small></span></div>
                <button className="btn sm ghost" onClick={() => void activateMap(m.id).then(() => patch({ sheet: null, screen: 'map' }))}>{t('countries.open')}</button>
                <button className="icon-btn danger-text" aria-label={t('common.delete')} onClick={() => void removeMap(m.id).then(refreshMapSources).then(refresh)}><Icon name="trash" size={18} /></button>
              </div>
            ))}
          </div>
        )}

        <h4 className="sect-sm">{t('countries.detail')}</h4>
        <div className="detail-grid">
          {DETAIL_PRESETS.map((p) => {
            const tiles = countTiles(c.bbox, 0, p.maxZoom);
            const est = estimateBytes(c.bbox, 0, p.maxZoom);
            const tooBig = est > MAX_DOWNLOAD_BYTES * 1.2;
            return (
              <button key={p.id} className={`detail-card ${detail === p.id ? 'on' : ''} ${tooBig ? 'big' : ''}`} onClick={() => setDetail(p.id)}>
                <b>{t(`countries.d.${p.id}`)}</b>
                <small>z ≤ {p.maxZoom}</small>
                <span className="dc-size">≈ {fmtSize(est)}</span>
                <small className="muted">{tiles.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')} {t('countries.tiles')}</small>
                {tooBig && <small className="warn-text">{t('countries.too_big')}</small>}
              </button>
            );
          })}
        </div>
        <small className="muted">{t('countries.estimate_hint')}</small>

        {running ? (
          <div className="card dl-card">
            <div className="dl-top"><b>{t('countries.downloading')}</b><small className="muted">{dl?.progress ? `${Math.round((dl.progress.done / Math.max(1, dl.progress.total)) * 100)}%` : '…'}</small></div>
            <div className="bar"><i style={{ width: `${dl?.progress ? (dl.progress.done / Math.max(1, dl.progress.total)) * 100 : 3}%` }} /></div>
            <small className="muted">{dl?.progress ? `${dl.progress.done.toLocaleString()} / ${dl.progress.total.toLocaleString()} ${t('countries.tiles')} · ${(dl.progress.bytes / 1e6).toFixed(1)} ${t('unit.mb')}` : t('countries.connecting')}</small>
            <button className="btn ghost" onClick={cancelDownload}>{t('common.cancel')}</button>
          </div>
        ) : (
          <>
            {dl?.state === 'error' && dl.code === c.code && <div className="banner-inline err"><Icon name="triangle-alert" size={16} /><span>{dl.error}</span></div>}
            <button className="btn primary block" onClick={() => startCountryDownload(c, detail)}>
              <Icon name="download" size={18} /> {t('countries.download')} · {t(`countries.d.${detail}`)} · ≈ {fmtSize(estimateBytes(c.bbox, 0, preset.maxZoom))}
            </button>
            {!enabled && <small className="muted">{t('countries.download_consent')}</small>}
          </>
        )}

        <div className="card source-card">
          <div className="set-row">
            <span><Icon name="globe" size={18} /> {t('countries.allow')}</span>
            <Switch checked={allow} onChange={(v) => usePrefs.getState().set({ allowDownloads: v })} label={t('countries.allow')} />
          </div>
          <small className="muted">{t('countries.allow_hint')}</small>
          {allow && (
            <>
              <label className="field"><span>{t('countries.source')}</span>
                <input className="input" value={source} onChange={(e) => { usePrefs.getState().set({ mapSourceUrl: e.target.value, resolvedSource: null }); setProbe({ state: 'idle' }); }} placeholder="https://…/planet.pmtiles" inputMode="url" autoCapitalize="off" spellCheck={false} />
              </label>
              <small className="muted">{t('countries.source_auto')}</small>
              <div className="row-btns">
                <button className="btn ghost sm" disabled={(!!source.trim() && !/^https?:\/\//i.test(source.trim())) || probe.state === 'busy'} onClick={() => void check()}>
                  {probe.state === 'busy' ? <span className="spinner" /> : <Icon name="refresh" size={14} />} {t('countries.probe')}
                </button>
                {probe.text && <small className={probe.state === 'ok' ? 'ok-text' : 'warn-text'}>{probe.text}</small>}
              </div>
            </>
          )}
        </div>

        <h4 className="sect-sm">{t('countries.offline_way')}</h4>
        <div className="card how">
          <small className="muted">{t('countries.cmd_hint')}</small>
          <code>{cmd}</code>
          <div className="row-btns">
            <button className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(cmd); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? t('countries.copied') : t('countries.copy')}
            </button>
            <button className="btn ghost sm" onClick={async () => {
              const f = await pickFile('.pmtiles,application/octet-stream');
              if (!f) return;
              try {
                const rec = await importMapFile(f, { name: `${c.flag} ${countryName(c, lang)}`, country: c.code });
                refresh();
                await activateMap(rec.id);
              } catch {
                useApp.getState().toast({ kind: 'error', title: t('maps.import_failed'), text: t('maps.not_pmtiles') });
              }
            }}>
              <Icon name="upload" size={14} /> {t('countries.import_file')}
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
