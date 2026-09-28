import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { CompassRose, ProgressRing } from './common';
import { mapApi } from '../map/MapView';
import { cancelMode, locateMe, saveZoneDraft, toggleMeasure, togglePeek } from '../state/actions';
import { cardinal, formatArea, formatCoords, formatDistance, haversine, pathLength } from '../core/geo';
import { startLocation } from '../services/location';
import { tap } from '../services/haptics';

export function Hud() {
  const { t, lang } = useT();
  const level = useApp((s) => s.level);
  const heading = useApp((s) => s.heading);
  const bearing = useApp((s) => s.mapBearing);
  const follow = useApp((s) => s.follow);
  const peek = useApp((s) => s.peek);
  const mode = useApp((s) => s.mode);
  const gps = useApp((s) => s.gps);
  const inZone = useApp((s) => s.inZone);
  const missing = useApp((s) => s.mapMissing);
  const mapInfo = useApp((s) => s.mapInfo);
  const stats = useApp((s) => s.stats);
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);
  const orient = useApp((s) => s.orientMap);

  const banner = (() => {
    if (mode !== 'normal') return null;
    if (gps === 'denied')
      return { icon: 'locate-off', text: t('gps.denied'), tone: 'warn', action: { label: t('gps.retry'), run: () => void startLocation() } };
    if (inZone) return { icon: 'shield', text: t('gps.in_zone'), tone: 'warn' };
    if (gps === 'searching') return { icon: 'locate', text: t('gps.searching'), tone: 'info' };
    if (gps === 'weak') return { icon: 'locate', text: t('gps.weak'), tone: 'warn' };
    if (missing && mapInfo)
      return { icon: 'map', text: t('map.missing'), tone: 'info', action: { label: t('map.go'), run: () => patch({ fitBounds: { bounds: mapInfo.bounds, nonce: Date.now() } }) } };
    if (peek) return { icon: 'eye', text: t('hud.peek_on'), tone: 'info', action: { label: t('hud.peek_off'), run: togglePeek } };
    return null;
  })();

  return (
    <div className="hud">
      <header className="hud-top">
        <button className="level-chip glass" onClick={() => patch({ screen: 'quests' })} aria-label={t('tab.quests')}>
          <ProgressRing value={level.progress} size={46} stroke={4}>
            <b>{level.level}</b>
          </ProgressRing>
          <span className="lc-text">
            <b>{t(level.titleKey)}</b>
            <small>
              {level.maxed ? 'MAX' : `${level.into} / ${level.span} XP`}
            </small>
          </span>
        </button>
        <button className="compass-pill glass" onClick={() => patch({ sheet: { type: 'compass' } })} aria-label={t('compass.title')}>
          <span className="cp-needle">
            <CompassRose size={28} angle={-(heading ?? 0)} />
          </span>
          <span className="cp-text">
            {heading === null ? '—' : `${Math.round(heading)}°`}
            <small>{heading === null ? '' : cardinal(heading, lang)}</small>
          </span>
        </button>
      </header>

      {banner && (
        <div className={`banner glass tone-${banner.tone}`}>
          <Icon name={banner.icon} size={16} />
          <span>{banner.text}</span>
          {banner.action && (
            <button onClick={banner.action.run} className="banner-act">
              {banner.action.label}
            </button>
          )}
        </div>
      )}

      <div className={`fab-col ${mode === 'measure' ? 'raised' : mode === 'normal' ? '' : 'hidden'}`}>
        {Math.abs(bearing) > 1 && !orient && (
          <button className="fab glass" onClick={() => { tap(); mapApi.resetNorth(); }} aria-label={t('hud.north')}>
            <CompassRose size={26} angle={-bearing} />
          </button>
        )}
        <button className={`fab glass ${follow ? 'on' : ''}`} onClick={locateMe} aria-label={t('hud.locate')}>
          <Icon name={gps === 'denied' ? 'locate-off' : 'locate'} />
        </button>
        <button className={`fab glass ${peek ? 'on' : ''}`} onClick={togglePeek} aria-label={t('hud.peek')}>
          <Icon name={peek ? 'eye' : 'eye-off'} />
        </button>
        <button className={`fab glass ${mode === 'measure' ? 'on' : ''}`} onClick={toggleMeasure} aria-label={t('hud.measure')}>
          <Icon name="ruler" />
        </button>
      </div>

      {mode === 'normal' && (
        <div className="stat-pill glass">
          <span>
            <Icon name="map" size={14} />
            <b>{formatArea(stats.areaM2, units, lang)}</b>
          </span>
          <i />
          <span>
            <Icon name="footprints" size={14} />
            <b>{formatDistance(stats.today.distanceM, units, lang)}</b>
            <small>{t('hud.today')}</small>
          </span>
          <i />
          <span>
            <Icon name="pin" size={14} />
            <b>{stats.notes}</b>
          </span>
        </div>
      )}

      {mode === 'measure' && <MeasurePanel />}
      {(mode === 'pick' || mode === 'zone') && <Crosshair />}
      {mode === 'pick' && <PickPanel />}
      {mode === 'zone' && <ZonePanel />}
    </div>
  );
}

function MeasurePanel() {
  const { t, lang } = useT();
  const points = useApp((s) => s.measurePoints);
  const patch = useApp((s) => s.patch);
  const pos = useApp((s) => s.position);
  const units = usePrefs((s) => s.units);
  const total = pathLength(points);
  const last = points.length > 1 ? haversine(points[points.length - 2], points[points.length - 1]) : 0;
  return (
    <div className="mode-panel glass">
      <div className="mp-head">
        <span className="mp-title">
          <Icon name="ruler" size={16} /> {t('measure.title')}
        </span>
        <button className="icon-btn" onClick={() => patch({ mode: 'normal', measurePoints: [] })} aria-label="close">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="mp-value">
        <b>{formatDistance(total, units, lang)}</b>
        {points.length > 1 && (
          <small>
            {t('measure.last')}: {formatDistance(last, units, lang)}
          </small>
        )}
      </div>
      <p className="mp-hint">{points.length === 0 ? t('measure.hint') : t('measure.points', { n: points.length })}</p>
      <div className="mp-actions">
        <button className="btn ghost" disabled={!pos} onClick={() => pos && patch({ measurePoints: [...points, { lng: pos.lng, lat: pos.lat }] })}>
          <Icon name="locate" size={16} /> {t('measure.from_me')}
        </button>
        <button className="btn ghost" disabled={!points.length} onClick={() => patch({ measurePoints: points.slice(0, -1) })}>
          <Icon name="undo" size={16} /> {t('measure.undo')}
        </button>
        <button className="btn ghost" disabled={!points.length} onClick={() => patch({ measurePoints: [] })}>
          <Icon name="trash" size={16} />
        </button>
      </div>
    </div>
  );
}

function Crosshair() {
  return (
    <div className="crosshair" aria-hidden>
      <svg width="54" height="54" viewBox="0 0 54 54" fill="none">
        <circle cx="27" cy="27" r="8" stroke="#fff" strokeWidth="2.4" />
        <path d="M27 3v14M27 37v14M3 27h14M37 27h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="27" cy="27" r="2.2" fill="#fff" />
      </svg>
    </div>
  );
}

function PickPanel() {
  const { t } = useT();
  const draft = useApp((s) => s.draft);
  const patch = useApp((s) => s.patch);
  return (
    <div className="mode-panel glass">
      <div className="mp-head">
        <span className="mp-title">
          <Icon name="pin" size={16} /> {t('pick.title')}
        </span>
      </div>
      <p className="mp-hint">{t('pick.hint')}</p>
      <div className="mp-coords">{draft && formatCoords(draft)}</div>
      <div className="mp-actions">
        <button className="btn ghost" onClick={cancelMode}>
          {t('common.cancel')}
        </button>
        <button className="btn primary grow" onClick={() => patch({ mode: 'normal', sheet: { type: 'editor' } })}>
          <Icon name="check" size={16} /> {t('pick.done')}
        </button>
      </div>
    </div>
  );
}

function ZonePanel() {
  const { t, lang } = useT();
  const d = useApp((s) => s.zoneDraft);
  const patch = useApp((s) => s.patch);
  const pos = useApp((s) => s.position);
  const units = usePrefs((s) => s.units);
  const [, force] = useState(0);
  useEffect(() => force(1), []);
  if (!d) return null;
  // логарифмический ползунок 50 м … 5 км
  const slider = Math.round((Math.log(d.radius / 50) / Math.log(100)) * 100);
  return (
    <div className="mode-panel glass zone-panel">
      <div className="mp-head">
        <span className="mp-title">
          <Icon name="shield" size={16} /> {d.id ? t('zones.edit') : t('zones.new')}
        </span>
        <button className="icon-btn" onClick={cancelMode} aria-label="close">
          <Icon name="x" size={18} />
        </button>
      </div>
      <input className="input" value={d.name} maxLength={28} onChange={(e) => patch({ zoneDraft: { ...d, name: e.target.value } })} placeholder={t('zones.name')} />
      <div className="slider-row">
        <span>{t('zones.radius')}</span>
        <b>{formatDistance(d.radius, units, lang)}</b>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={slider}
        onChange={(e) => patch({ zoneDraft: { ...d, radius: Math.round((50 * 100 ** (Number(e.target.value) / 100)) / 10) * 10 } })}
      />
      <p className="mp-hint">{t('zones.hint')}</p>
      <div className="mp-actions">
        <button className="btn ghost" disabled={!pos} onClick={() => pos && patch({ zoneDraft: { ...d, lng: pos.lng, lat: pos.lat }, flyTo: { lng: pos.lng, lat: pos.lat, zoom: 15, nonce: Date.now() } })}>
          <Icon name="locate" size={16} /> {t('zones.here')}
        </button>
        <button className="btn primary grow" onClick={saveZoneDraft}>
          <Icon name="check" size={16} /> {t('common.save')}
        </button>
      </div>
    </div>
  );
}
