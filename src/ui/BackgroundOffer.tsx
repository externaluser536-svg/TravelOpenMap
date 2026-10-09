import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { setBackgroundTracking } from '../services/location';

/** После первого GPS: записывать ли маршрут, когда приложение закрыто. Можно отказаться — включить позже в настройках. */
export function BackgroundOffer() {
  const { t } = useT();
  const open = useApp((s) => s.bgOffer);
  if (!open) return null;
  const done = () => {
    usePrefs.getState().set({ backgroundPrompted: true });
    useApp.getState().patch({ bgOffer: false });
  };
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={t('bg.offer.title')}>
      <div className="modal download-modal" onClick={(e) => e.stopPropagation()}>
        <span className="dm-ic">
          <Icon name="navigation" size={30} strokeWidth={1.9} />
        </span>
        <h2>{t('bg.offer.title')}</h2>
        <p>{t('bg.offer.text')}</p>
        <button
          className="btn primary block"
          onClick={() => {
            done();
            void setBackgroundTracking(true);
          }}
        >
          <Icon name="play" size={18} /> {t('bg.offer.yes')}
        </button>
        <button className="btn ghost block" onClick={done}>
          {t('bg.offer.no')}
        </button>
        <small className="muted">{t('bg.offer.later')}</small>
      </div>
    </div>
  );
}
