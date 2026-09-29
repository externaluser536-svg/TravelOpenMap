import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet, Switch } from '../common';
import { setOnlineMaps } from '../../state/downloads';

type LayerId = 'subway' | 'outdoors' | 'elevation';
const LAYERS: { id: LayerId; icon: string; color: string }[] = [
  { id: 'subway', icon: 'train-front', color: '#F472B6' },
  { id: 'outdoors', icon: 'trees', color: '#3DDC97' },
  { id: 'elevation', icon: 'mountain', color: '#FFB547' },
];

/** Слои карты: метро, активный отдых, высоты. Работают на онлайн-карте (тайлы и рельеф кэшируются). */
export function LayersSheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const online = usePrefs((s) => s.onlineMaps);
  const layers = usePrefs((s) => s.mapLayers);
  return (
    <Sheet title={t('layers.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        {!online && (
          <div className="card explain">
            <span className="ex-ic">
              <Icon name="globe" size={22} />
            </span>
            <div className="grid-gap">
              <p>{t('layers.needs_online')}</p>
              <button className="btn primary sm" onClick={() => setOnlineMaps(true)}>
                <Icon name="download" size={15} /> {t('layers.enable_online')}
              </button>
            </div>
          </div>
        )}
        <div className="card list">
          {LAYERS.map((l) => (
            <div key={l.id} className={`set-row layer-row ${online ? '' : 'dim'}`} style={{ ['--c' as string]: l.color }}>
              <span className="layer-ic">
                <Icon name={l.icon} size={20} />
              </span>
              <span className="layer-text">
                <b>{t(`layers.${l.id}`)}</b>
                <small className="muted">{t(`layers.${l.id}_sub`)}</small>
              </span>
              <Switch checked={layers[l.id]} onChange={(v) => online && usePrefs.getState().set({ mapLayers: { ...layers, [l.id]: v } })} label={t(`layers.${l.id}`)} />
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  );
}
