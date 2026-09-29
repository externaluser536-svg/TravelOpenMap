import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { CompassRose, ProgressRing } from './common';
import { mapApi } from '../map/MapView';
import { applyFogDraft, cancelMode, locateMe, saveZoneDraft, startFogEdit, startMeasureAt, redoFogEdit, startNoteAt, toggleMeasure, togglePeek, undoFogEdit } from '../state/actions';
import { polygonAreaM2 } from '../core/fogedit';
import type { FogDraft } from '../state/store';
import { cardinal, formatArea, formatCoords, formatDistance, haversine, pathLength } from '../core/geo';
import { startLocation } from '../services/location';
import { WorkoutPanel } from './pages/WorkoutPage';
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
  const training = useApp((s) => s.workoutLive !== null);
  const fogTool = useApp((s) => s.fogDraft?.tool);

  const banner = (() => {
    if (mode !== 'normal' || training) return null;
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
        <button className="level-chip glass" onClick={() => patch({ screen: 'profile', profileTab: 'quests' })} aria-label={t('profile.tab.quests')}>
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

      <div className={`fab-col ${training ? 'raised' : mode === 'measure' ? 'raised' : mode === 'normal' ? '' : 'hidden'}`}>
        {Math.abs(bearing) > 1 && !orient && (
          <button className="fab glass" onClick={() => { tap(); mapApi.resetNorth(); }} aria-label={t('hud.north')}>
            <CompassRose size={26} angle={-bearing} />
          </button>
        )}
        <button className={`fab glass ${follow ? 'on' : ''}`} onClick={locateMe} aria-label={t('hud.locate')} data-tour="locate">
          <Icon name={gps === 'denied' ? 'locate-off' : 'locate'} />
        </button>
        <button className={`fab glass ${peek ? 'on' : ''}`} onClick={togglePeek} aria-label={t('hud.peek')} data-tour="peek">
          <Icon name={peek ? 'eye' : 'eye-off'} />
        </button>
        <button className={`fab glass ${mode === 'measure' ? 'on' : ''}`} onClick={toggleMeasure} aria-label={t('hud.measure')}>
          <Icon name="ruler" />
        </button>
        <button className="fab glass" onClick={() => startFogEdit('open')} aria-label={t('hud.fogedit')} data-tour="fogedit">
          <Icon name="brush" />
        </button>
        <button className="fab glass" onClick={() => patch({ sheet: { type: 'layers' } })} aria-label={t('hud.layers')} data-tour="layers">
          <Icon name="layers" />
        </button>
      </div>

      {training && <WorkoutPanel />}
      {mode === 'normal' && !training && (
        <div className="stat-pill glass" data-tour="stats">
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
      {mode === 'fogedit' && fogTool === 'circle' && <Crosshair fog />}
      {mode === 'fogedit' && <FogEditPanel />}
      <MapMenuView />
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

function Crosshair({ fog }: { fog?: boolean }) {
  return (
    <div className={`crosshair ${fog ? 'fog' : ''}`} aria-hidden>
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

const BRUSH_SIZES = [14, 24, 36, 54];

function FogEditPanel() {
  const { t, lang } = useT();
  const d = useApp((s) => s.fogDraft);
  const canUndo = useApp((s) => s.canUndoFog);
  const canRedo = useApp((s) => s.canRedoFog);
  const patch = useApp((s) => s.patch);
  const units = usePrefs((s) => s.units);
  if (!d) return null;
  const set = (p: Partial<FogDraft>) => patch({ fogDraft: { ...d, ...p } });
  const open = d.action === 'open';
  const size = d.tool === 'circle' ? Math.PI * d.radius * d.radius : d.tool === 'area' ? polygonAreaM2(d.poly) : 0;
  // логарифмический ползунок 30 м … 5 км
  const slider = Math.round((Math.log(d.radius / 30) / Math.log(5000 / 30)) * 100);
  const ready = d.tool === 'circle' || d.poly.length >= 3;
  const setBrush = (px: number) => {
    usePrefs.getState().set({ brushPx: px });
    set({ brushPx: px });
  };
  const tools = [
    { id: 'brush' as const, icon: 'brush', label: t('fogedit.tool_brush') },
    { id: 'circle' as const, icon: 'circle', label: t('fogedit.tool_circle') },
    { id: 'area' as const, icon: 'polygon', label: t('fogedit.tool_area') },
  ];
  return (
    <div className={`mode-panel glass fog-panel ${open ? 'is-open' : 'is-close'}`} data-tour="fogpanel">
      <div className="mp-head">
        <span className="mp-title">
          <Icon name="brush" size={16} /> {t('fogedit.title')}
        </span>
        <div className="fp-history">
          <button className="icon-btn" disabled={!canUndo} onClick={undoFogEdit} aria-label={t('fogedit.undo_last')} title={t('fogedit.undo_last')}>
            <Icon name="undo" size={18} />
          </button>
          <button className="icon-btn" disabled={!canRedo} onClick={redoFogEdit} aria-label={t('fogedit.redo')} title={t('fogedit.redo')}>
            <Icon name="redo" size={18} />
          </button>
        </div>
      </div>

      <div className="fp-action" role="group" aria-label={t('fogedit.action')}>
        <button className={`fp-act is-open ${open ? 'on' : ''}`} onClick={() => set({ action: 'open' })}>
          <Icon name="cloud-off" size={18} />
          <span>{t('fogedit.open')}</span>
          <small>{t('fogedit.open_sub')}</small>
        </button>
        <button className={`fp-act is-close ${!open ? 'on' : ''}`} onClick={() => set({ action: 'close' })}>
          <Icon name="cloud" size={18} />
          <span>{t('fogedit.close')}</span>
          <small>{t('fogedit.close_sub')}</small>
        </button>
      </div>

      <div className="fp-tools" role="group" aria-label={t('fogedit.tool')}>
        {tools.map((x) => (
          <button key={x.id} className={`fp-tool ${d.tool === x.id ? 'on' : ''}`} onClick={() => set({ tool: x.id, pan: false, poly: [] })}>
            <Icon name={x.icon} size={18} />
            <span>{x.label}</span>
          </button>
        ))}
      </div>

      {d.tool === 'brush' && (
        <>
          <div className="fp-brush">
            <div className="fp-sizes" role="group" aria-label={t('fogedit.size')}>
              {BRUSH_SIZES.map((px) => (
                <button key={px} className={`fp-size-btn ${d.brushPx === px ? 'on' : ''}`} onClick={() => setBrush(px)} aria-label={`${t('fogedit.size')} ${px}`}>
                  <i style={{ width: px * 0.62, height: px * 0.62 }} />
                </button>
              ))}
            </div>
            <button className={`fp-pan ${d.pan ? 'on' : ''}`} onClick={() => set({ pan: !d.pan })} aria-pressed={d.pan}>
              <Icon name="hand" size={16} /> {t('fogedit.pan')}
            </button>
          </div>
          <p className="mp-hint">{d.pan ? t('fogedit.hint_pan') : t(open ? 'fogedit.hint_brush_open' : 'fogedit.hint_brush_close')}</p>
        </>
      )}
      {d.tool === 'circle' && (
        <>
          <div className="slider-row">
            <span>{t('fogedit.radius')}</span>
            <b>{formatDistance(d.radius, units, lang)}</b>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={slider}
            aria-label={t('fogedit.radius')}
            onChange={(e) => set({ radius: Math.max(30, Math.round((30 * (5000 / 30) ** (Number(e.target.value) / 100)) / 10) * 10) })}
          />
          <p className="mp-hint">{t(open ? 'fogedit.hint_open' : 'fogedit.hint_close')}</p>
        </>
      )}
      {d.tool === 'area' && <p className="mp-hint">{d.poly.length ? t('fogedit.points', { n: d.poly.length }) : t('fogedit.hint_area')}</p>}

      {size > 0 && <div className="fp-size">{t('fogedit.area_size', { area: formatArea(size, units, lang) })}</div>}

      <div className="mp-actions">
        {d.tool === 'area' && (
          <>
            <button className="btn ghost" disabled={!d.poly.length} onClick={() => set({ poly: d.poly.slice(0, -1) })} aria-label={t('fogedit.undo_vertex')}>
              <Icon name="undo" size={16} />
            </button>
            <button className="btn ghost" disabled={!d.poly.length} onClick={() => set({ poly: [] })} aria-label={t('fogedit.clear')}>
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
        {d.tool !== 'brush' && (
          <button className={`btn grow ${open ? 'primary' : 'danger'}`} disabled={!ready} onClick={() => void applyFogDraft()}>
            <Icon name={open ? 'cloud-off' : 'cloud'} size={16} /> {t(open ? 'fogedit.apply_open' : 'fogedit.apply_close')}
          </button>
        )}
        <button className={`btn ${d.tool === 'brush' ? 'primary grow' : 'ghost'}`} onClick={cancelMode}>
          <Icon name="check" size={16} /> {t('fogedit.finish')}
        </button>
      </div>
      <small className="muted fp-note">{t('fogedit.note')}</small>
    </div>
  );
}

/** Меню долгого нажатия: метка, открыть/закрыть туман, измерить. */
function MapMenuView() {
  const { t, lang } = useT();
  const m = useApp((s) => s.mapMenu);
  const patch = useApp((s) => s.patch);
  const pos = useApp((s) => s.position);
  const units = usePrefs((s) => s.units);
  if (!m) return null;
  const W = 252;
  const root = document.querySelector('.map-root');
  const vw = root?.clientWidth ?? window.innerWidth;
  const vh = root?.clientHeight ?? window.innerHeight;
  const left = Math.max(10, Math.min(vw - W - 10, m.x - W / 2));
  const below = m.y < vh * 0.55;
  const style = below ? { left, top: Math.min(vh - 260, m.y + 26) } : { left, bottom: Math.max(10, vh - m.y + 26) };
  const at = { lng: m.lng, lat: m.lat };
  return (
    <>
      <div className="menu-backdrop" onClick={() => patch({ mapMenu: null })} />
      <div className={`map-menu glass ${below ? 'below' : 'above'}`} style={{ ...style, width: W }} role="menu">
        <div className="mm-head">
          <b>{t('menu.title')}</b>
          <small>
            {formatCoords(at)}
            {pos ? ` · ${t('menu.from_me', { d: formatDistance(haversine(pos, at), units, lang) })}` : ''}
          </small>
        </div>
        <button role="menuitem" className="mm-item" onClick={() => startNoteAt(at)}>
          <Icon name="pin-plus" size={18} /> {t('menu.note')}
        </button>
        <button role="menuitem" className="mm-item" onClick={() => startFogEdit('open', at)}>
          <Icon name="cloud-off" size={18} /> {t('menu.open')}
        </button>
        <button role="menuitem" className="mm-item" onClick={() => startFogEdit('close', at)}>
          <Icon name="cloud" size={18} /> {t('menu.close')}
        </button>
        <button role="menuitem" className="mm-item" onClick={() => startMeasureAt(at)}>
          <Icon name="ruler" size={18} /> {t('menu.measure')}
        </button>
      </div>
    </>
  );
}
