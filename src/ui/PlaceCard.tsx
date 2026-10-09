import { useEffect } from 'react';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { formatCoords, formatDistance, haversine } from '../core/geo';
import { startMeasureAt, startNoteAt } from '../state/actions';

/** Карточка «что за место»: появляется по нажатию на карту и показывает то, что известно из данных карты. */
export function PlaceCard() {
  const { t, lang } = useT();
  const place = useApp((s) => s.place);
  const mode = useApp((s) => s.mode);
  const screen = useApp((s) => s.screen);
  const sheet = useApp((s) => s.sheet);
  const position = useApp((s) => s.position);
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);

  // карточка живёт только пока открыта карта в обычном режиме и ничего не перекрывает её
  const hidden = mode !== 'normal' || screen !== 'map' || !!sheet;
  useEffect(() => {
    if (hidden && place) patch({ place: null });
  }, [hidden, place, patch]);
  if (!place || hidden) return null;

  const close = () => patch({ place: null });
  const away = position ? formatDistance(haversine(position, place), units, lang) : null;
  const title = place.title ?? t('place.none');
  const copy = () => {
    void navigator.clipboard?.writeText(formatCoords(place)).then(
      () => useApp.getState().toast({ kind: 'info', title: t('place.copied'), icon: 'check' }),
      () => {},
    );
  };
  return (
    <div className="place-card glass" role="dialog" aria-label={title} data-tour="place">
      <div className="pc-head">
        <span className={`pc-ic kind-${place.kind}`}>
          <Icon name={place.icon} size={22} />
        </span>
        <div className="pc-title">
          <b>{title}</b>
          <small className="muted">
            {[place.category, away ? t('place.from_me', { d: away }) : null].filter(Boolean).join(' · ') || ' '}
          </small>
        </div>
        <button className="icon-btn" onClick={close} aria-label={t('place.close')}>
          <Icon name="x" size={18} />
        </button>
      </div>
      {!place.found && <p className="pc-empty">{t('place.no_data')}</p>}
      {place.rows.length > 0 && (
        <dl className="pc-rows">
          {place.rows.map((r) => (
            <div key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {place.context.length > 0 && (
        <p className="pc-ctx">
          <span className="muted">{t('place.here')}</span> {place.context.join(' · ')}
        </p>
      )}
      <button className="pc-coords" onClick={copy} title={t('place.copy')}>
        <Icon name="pin" size={14} /> <span>{formatCoords(place)}</span> <Icon name="copy" size={14} />
      </button>
      <div className="pc-actions">
        <button className="btn primary grow" onClick={() => startNoteAt(place)}>
          <Icon name="plus" size={16} /> {t('place.add')}
        </button>
        <button className="btn ghost grow" onClick={() => startMeasureAt(place)}>
          <Icon name="ruler" size={16} /> {t('place.measure')}
        </button>
      </div>
    </div>
  );
}
