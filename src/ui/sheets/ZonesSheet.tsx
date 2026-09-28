import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { engine } from '../../state/engine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { formatDistance } from '../../core/geo';
import { startZoneEditor } from '../../state/actions';

export function ZonesSheet() {
  const { t, lang } = useT();
  const patch = useApp((s) => s.patch);
  const zones = usePrefs((s) => s.zones);
  const units = usePrefs((s) => s.units);
  return (
    <Sheet title={t('zones.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <div className="card explain">
          <span className="ex-ic">
            <Icon name="shield" size={22} />
          </span>
          <p>{t('zones.explain')}</p>
        </div>
        {zones.length === 0 ? (
          <p className="muted center">{t('zones.empty')}</p>
        ) : (
          <div className="card list">
            {zones.map((z) => (
              <div key={z.id} className="zone-item">
                <span className="zi-ic">
                  <Icon name="ban" size={18} />
                </span>
                <div className="zi-main">
                  <b>{z.name}</b>
                  <small>
                    {t('zones.radius')}: {formatDistance(z.radius, units, lang)}
                  </small>
                </div>
                <button className="icon-btn" onClick={() => patch({ sheet: null, screen: 'map', flyTo: { lng: z.lng, lat: z.lat, zoom: 14.5, nonce: Date.now() } })} aria-label={t('note.show')}>
                  <Icon name="map" size={18} />
                </button>
                <button className="icon-btn" onClick={() => startZoneEditor(z)} aria-label={t('common.edit')}>
                  <Icon name="pencil" size={18} />
                </button>
                <button className="icon-btn danger-text" onClick={() => engine.setZones(zones.filter((x) => x.id !== z.id))} aria-label={t('common.delete')}>
                  <Icon name="trash" size={18} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button className="btn primary block" onClick={() => startZoneEditor()}>
          <Icon name="plus" size={18} /> {t('zones.add')}
        </button>
      </div>
    </Sheet>
  );
}
