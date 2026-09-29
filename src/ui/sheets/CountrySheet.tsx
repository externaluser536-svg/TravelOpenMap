import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet, Switch } from '../common';
import { CountryPicker } from '../CountryPicker';
import { DETAIL_PRESETS, countryByCode, countryName, type DetailId } from '../../data/countries';
import { MAX_AREA_TILES, planArea as planTiles } from '../../map/offline-areas';
import { fmtBytes } from '../format';
import { cancelDownload, deleteSavedArea, startCountryDownload } from '../../state/downloads';
import { importMapFile } from '../../map/maps';
import { activateMap } from '../../state/actions';
import { pickFile } from '../../services/files';

/** Обзор стран: выбор страны для загрузки карты. */
export function CountriesSheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const saved = usePrefs((s) => s.savedAreas);
  const have = new Set(saved.map((a) => a.id.split(':')[0]));
  return (
    <Sheet tall title={t('countries.title')} onClose={() => patch({ sheet: null })} back={() => patch({ sheet: { type: 'maps' } })}>
      <CountryPicker
        onPick={(c) => patch({ sheet: { type: 'country', code: c.code } })}
        badge={(c) => (have.has(c.code) ? <span className="chip" style={{ ['--c' as string]: 'var(--s3)' }}><Icon name="check" size={11} strokeWidth={3} /> {t('countries.have')}</span> : null)}
      />
    </Sheet>
  );
}

export function CountrySheet({ code }: { code: string }) {
  const { t, lang } = useT();
  const c = countryByCode(code);
  const patch = useApp((s) => s.patch);
  const dl = useApp((s) => s.download);
  const online = usePrefs((s) => s.onlineMaps);
  const elevation = usePrefs((s) => s.mapLayers.elevation);
  const saved = usePrefs((s) => s.savedAreas);
  const [detail, setDetail] = useState<DetailId>('city');
  const [withDem, setWithDem] = useState(elevation);
  if (!c) return null;
  const preset = DETAIL_PRESETS.find((d) => d.id === detail)!;
  const running = dl?.state === 'running' && dl.code.startsWith(`${c.code}:`);
  const mine = saved.filter((a) => a.id.startsWith(`${c.code}:`));
  const plan = planTiles({ bbox: c.bbox, maxZoom: preset.maxZoom, dem: withDem });
  const tooBig = plan.total > MAX_AREA_TILES;

  return (
    <Sheet tall title={<span className="country-title"><span className="flag big">{c.flag}</span>{countryName(c, lang)}</span>} onClose={() => patch({ sheet: null })} back={() => patch({ sheet: { type: 'countries' } })}>
      <div className="form">
        <p className="muted">{t(`region.${c.region}`)}{lang === 'en' && c.sub ? ` · ${c.sub}` : ''} · {c.area.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')} {t('unit.km2')}</p>

        {mine.length > 0 && (
          <div className="card list">
            {mine.map((a) => (
              <div key={a.id} className="map-item">
                <span className="mi-radio on"><Icon name="check" size={14} strokeWidth={3.2} /></span>
                <div className="mi-main static"><span><b>{t(`countries.d.${a.id.split(':')[1]}`)} · z ≤ {a.maxZoom}</b><small>{a.tiles.toLocaleString()} {t('countries.tiles')}{a.dem ? ` · ${t('layers.elevation')}` : ''}</small></span></div>
                <button className="btn sm ghost" onClick={() => patch({ sheet: null, screen: 'map', fitBounds: { bounds: a.bbox, nonce: Date.now() } })}>{t('countries.open')}</button>
                <button className="icon-btn danger-text" aria-label={t('common.delete')} onClick={() => void deleteSavedArea(a.id)}><Icon name="trash" size={18} /></button>
              </div>
            ))}
          </div>
        )}

        <h4 className="sect-sm">{t('countries.detail')}</h4>
        <div className="detail-grid">
          {DETAIL_PRESETS.map((p) => {
            const pl = planTiles({ bbox: c.bbox, maxZoom: p.maxZoom, dem: withDem });
            const big = pl.total > MAX_AREA_TILES;
            return (
              <button key={p.id} className={`detail-card ${detail === p.id ? 'on' : ''} ${big ? 'big' : ''}`} onClick={() => setDetail(p.id)}>
                <b>{t(`countries.d.${p.id}`)}</b>
                <small>z ≤ {p.maxZoom}</small>
                <span className="dc-size">≈ {fmtBytes(pl.estimate)}</span>
                <small className="muted">{pl.total.toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-GB')} {t('countries.tiles')}</small>
                {big && <small className="warn-text">{t('countries.too_big')}</small>}
              </button>
            );
          })}
        </div>
        <div className="set-row">
          <span><Icon name="mountain" size={18} /> {t('saved.with_relief')}</span>
          <Switch checked={withDem} onChange={setWithDem} label={t('saved.with_relief')} />
        </div>
        <small className="muted">{t('countries.estimate_hint')}</small>

        {running ? (
          <div className="card dl-card">
            <div className="dl-top"><b>{t('dl.running', { name: dl!.name })}</b><small className="muted">{dl?.progress ? `${Math.round((dl.progress.done / Math.max(1, dl.progress.total)) * 100)}%` : '…'}</small></div>
            <div className="bar"><i style={{ width: `${dl?.progress ? (dl.progress.done / Math.max(1, dl.progress.total)) * 100 : 3}%` }} /></div>
            <small className="muted">{dl?.progress ? `${dl.progress.done.toLocaleString()} / ${dl.progress.total.toLocaleString()} ${t('countries.tiles')} · ${(dl.progress.bytes / 1e6).toFixed(1)} ${t('unit.mb')}` : t('countries.connecting')}</small>
            <button className="btn ghost" onClick={cancelDownload}>{t('common.cancel')}</button>
          </div>
        ) : (
          <>
            {dl?.state === 'error' && dl.code.startsWith(`${c.code}:`) && <div className="banner-inline err"><Icon name="triangle-alert" size={16} /><span>{dl.error}</span></div>}
            <button className="btn primary block" disabled={tooBig} onClick={() => startCountryDownload(c, detail, withDem)}>
              <Icon name="download" size={18} /> {t('saved.save')} · {t(`countries.d.${detail}`)} · ≈ {fmtBytes(plan.estimate)}
            </button>
            {!online && <small className="muted">{t('saved.needs_online')}</small>}
          </>
        )}

        <h4 className="sect-sm">{t('countries.offline_way')}</h4>
        <div className="card how">
          <small className="muted">{t('countries.file_hint')}</small>
          <div className="row-btns">
            <button className="btn ghost sm" onClick={async () => {
              const f = await pickFile('.pmtiles,application/octet-stream');
              if (!f) return;
              try {
                const rec = await importMapFile(f, { name: `${c.flag} ${countryName(c, lang)}`, country: c.code });
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
