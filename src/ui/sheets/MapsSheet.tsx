import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { importMapFile, loadCatalog, removeMap, type CatalogEntry } from '../../map/maps';
import { activateMap } from '../../state/actions';
import { pickFile } from '../../services/files';

export function MapsSheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const active = usePrefs((s) => s.activeMapId);
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => void loadCatalog().then(setItems);
  useEffect(refresh, []);

  const activate = activateMap;

  const doImport = async () => {
    const f = await pickFile('.pmtiles,application/octet-stream');
    if (!f) return;
    setBusy(true);
    try {
      const rec = await importMapFile(f);
      refresh();
      await activate(rec.id);
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
      if (first) await activate(first.id);
    }
    refresh();
  };

  return (
    <Sheet tall title={t('maps.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <p className="muted">{t('maps.intro')}</p>
        <div className="card list">
          {items.map((m) => (
            <div key={m.id} className={`map-item ${m.id === active ? 'on' : ''}`}>
              <button className="mi-main" onClick={() => void activate(m.id)}>
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
        <button className="btn primary block" onClick={() => patch({ sheet: { type: 'countries' } })}>
          <Icon name="globe" size={18} /> {t('countries.choose')}
        </button>
        <button className="btn ghost block" disabled={busy} onClick={() => void doImport()}>
          <Icon name="upload" size={18} /> {busy ? t('common.loading') : t('maps.import')}
        </button>
        <div className="card how">
          <b>{t('maps.how_title')}</b>
          <ol>
            <li>{t('maps.how1')}</li>
            <li>{t('maps.how2')}</li>
            <li>{t('maps.how3')}</li>
          </ol>
          <code>pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles city.pmtiles --bbox=W,S,E,N</code>
        </div>
      </div>
    </Sheet>
  );
}
