import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { workoutEngine } from '../../state/workoutEngine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { RouteSvg } from '../RouteSvg';
import { distNum, paceText, paceUnit, speedText, speedUnit } from '../format';
import { formatDuration } from '../../core/workout';
import { formatArea } from '../../core/geo';
import { toGpx } from '../../core/gpx';
import { saveFile } from '../../services/files';
import { fmtDate } from '../hooks';

export function WorkoutSheet({ id }: { id: string }) {
  const { t, lang } = useT();
  const w = useApp((s) => s.workouts.find((x) => x.id === id));
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);
  const [confirm, setConfirm] = useState(false);
  if (!w) return null;
  const route = w.points.map((p): [number, number] => [p[0], p[1]]);
  const unitD = units === 'imperial' ? 'mi' : t('unit.km');
  const fastest = w.splits.length ? Math.min(...w.splits.map((s) => s.paceS)) : 0;
  const slowest = w.splits.length ? Math.max(...w.splits.map((s) => s.paceS)) : 0;
  const cell = (label: string, value: string, unit?: string, icon?: string) => (
    <div className="wk-cell">
      <small>{icon && <Icon name={icon} size={12} />} {label}</small>
      <b className="mono-num">{value}</b>
      {unit && <em>{unit}</em>}
    </div>
  );
  return (
    <Sheet tall title={<span className="note-title"><span className="chip solid" style={{ ['--c' as string]: w.type === 'run' ? 'var(--s5)' : 'var(--s1)' }}><Icon name={w.type === 'run' ? 'zap' : 'footprints'} size={13} /> {t(`workout.type.${w.type}`)}</span></span>} onClose={() => patch({ sheet: null })}>
      <div className="note-detail">
        <div>
          <h1 className="wk-h1">{distNum(w.distanceM, units)} <span>{unitD}</span></h1>
          <small className="muted">{fmtDate(w.startedAt, lang, true)}</small>
        </div>
        <div className="card"><RouteSvg points={route} fill={w.enclosedKind === 'loop'} ariaLabel={t('workout.route')} height={230} /></div>

        <div className="wk-cells">
          {cell(t('workout.time'), formatDuration(w.elapsedS), undefined, 'timer')}
          {cell(t('workout.pace_avg'), paceText(w.avgPaceS, units), paceUnit(units, t('unit.km')), 'gauge')}
          {cell(t('workout.speed'), speedText(w.avgSpeed, units), speedUnit(units, t('unit.kmh')), 'activity')}
          {cell(t('workout.kcal'), String(w.calories), t('unit.kcal'), 'flame')}
          {cell(t('workout.pace_best'), w.bestPaceS ? paceText(w.bestPaceS, units) : '–', paceUnit(units, t('unit.km')), 'zap')}
          {cell(t('workout.elev'), w.elevGainM === null ? '–' : String(w.elevGainM), t('unit.m'), 'mountain')}
        </div>

        <div className="card area-card">
          <div className="ac-row">
            <span className="ac-ic"><Icon name="map" size={18} /></span>
            <div>
              <small className="muted">{t('workout.area_corridor')}</small>
              <b>{formatArea(w.corridorM2, units, lang)}</b>
            </div>
          </div>
          {w.enclosedKind && (
            <div className="ac-row">
              <span className="ac-ic alt"><Icon name="target" size={18} /></span>
              <div>
                <small className="muted">{w.enclosedKind === 'loop' ? t('workout.area_loop') : t('workout.area_hull')}</small>
                <b>{formatArea(w.enclosedM2, units, lang)}</b>
              </div>
            </div>
          )}
          <small className="muted">{t('workout.area_hint')}</small>
        </div>

        {w.splits.length > 0 && (
          <div className="card">
            <b className="card-h">{t('workout.splits')}</b>
            <ul className="splits">
              {w.splits.map((s) => {
                const rel = slowest === fastest ? 0.7 : 0.35 + 0.65 * (1 - (s.paceS - fastest) / (slowest - fastest));
                return (
                  <li key={s.km} className={s.paceS === fastest ? 'best' : ''}>
                    <span>{s.km}</span>
                    <div className="sp-track"><i style={{ width: `${Math.round(rel * 100)}%` }} /></div>
                    <b className="mono-num">{paceText(s.paceS, units)}</b>
                  </li>
                );
              })}
            </ul>
            <small className="muted">{t('workout.splits_hint')}</small>
          </div>
        )}

        <div className="action-grid">
          <button className="btn ghost" onClick={() => void saveFile(`workout-${new Date(w.startedAt).toISOString().slice(0, 10)}.gpx`, toGpx([{ name: t(`workout.type.${w.type}`), points: w.points.map((p) => ({ lng: p[0], lat: p[1], t: p[2] })) }], []), 'application/gpx+xml')}>
            <Icon name="download" size={16} /> GPX
          </button>
          {confirm ? (
            <button className="btn danger" onClick={() => { void workoutEngine.remove(w.id); patch({ sheet: null }); }}>{t('common.delete')}?</button>
          ) : (
            <button className="btn ghost danger-text" onClick={() => setConfirm(true)}><Icon name="trash" size={16} /> {t('common.delete')}</button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
