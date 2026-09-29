import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { workoutEngine } from '../../state/workoutEngine';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Segmented } from '../common';
import { BarChart, ChartCard } from '../charts';
import { RouteSvg } from '../RouteSvg';
import { distNum, paceText, paceUnit, speedText, speedUnit } from '../format';
import { formatDuration } from '../../core/workout';
import { formatArea } from '../../core/geo';
import { dateKey } from '../../core/days';
import { addDaysKey } from '../../core/trips';
import type { Workout, WorkoutType } from '../../data/db';
import { fmtDate } from '../hooks';

export function WorkoutControls({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const live = useApp((s) => s.workoutLive);
  const [confirm, setConfirm] = useState(false);
  if (!live) return null;
  const paused = live.state === 'paused';
  const finish = async () => {
    const w = await workoutEngine.finish();
    setConfirm(false);
    if (w) useApp.getState().patch({ sheet: { type: 'workout', id: w.id }, screen: 'workout' });
  };
  if (confirm) {
    return (
      <div className={`wk-confirm ${compact ? 'compact' : ''}`}>
        <b>{t('workout.finish_q')}</b>
        <div className="row-btns">
          <button className="btn ghost grow" onClick={() => setConfirm(false)}>
            {t('workout.continue')}
          </button>
          <button className="btn danger" onClick={() => { workoutEngine.discard(); setConfirm(false); }}>
            <Icon name="trash" size={16} />
          </button>
          <button className="btn primary grow" onClick={() => void finish()}>
            <Icon name="check" size={16} /> {t('workout.finish')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`wk-controls ${compact ? 'compact' : ''}`}>
      <button className={`wk-btn ${paused ? 'go' : ''}`} onClick={() => (paused ? workoutEngine.resume() : workoutEngine.pause())} aria-label={paused ? t('workout.resume') : t('workout.pause')}>
        <Icon name={paused ? 'play' : 'pause'} size={compact ? 20 : 26} />
        {!compact && <span>{paused ? t('workout.resume') : t('workout.pause')}</span>}
      </button>
      <button className="wk-btn stop" onClick={() => setConfirm(true)} aria-label={t('workout.finish')}>
        <Icon name="square" size={compact ? 18 : 24} />
        {!compact && <span>{t('workout.finish')}</span>}
      </button>
    </div>
  );
}

/** Компактная панель тренировки поверх карты. */
export function WorkoutPanel() {
  const { t } = useT();
  const live = useApp((s) => s.workoutLive);
  const units = usePrefs((s) => s.units);
  if (!live) return null;
  return (
    <div className="mode-panel glass wk-panel">
      <div className="wp-row">
        <span className={`wp-type ${live.state}`}>
          <Icon name={live.type === 'run' ? 'zap' : 'footprints'} size={15} /> {t(`workout.type.${live.type}`)}
          {live.state === 'paused' && ` · ${t('workout.paused')}`}
        </span>
      </div>
      <div className="wp-metrics">
        <div><b className="mono-num">{formatDuration(live.elapsedS)}</b><small>{t('workout.time')}</small></div>
        <div><b className="mono-num">{distNum(live.distanceM, units)}</b><small>{units === 'imperial' ? 'mi' : t('unit.km')}</small></div>
        <div><b className="mono-num">{paceText(live.currentPaceS ?? live.avgPaceS, units)}</b><small>{t('workout.pace')} {paceUnit(units, t('unit.km'))}</small></div>
      </div>
      <WorkoutControls compact />
    </div>
  );
}

function LiveView() {
  const { t } = useT();
  const live = useApp((s) => s.workoutLive)!;
  const route = useApp((s) => s.workoutRoute);
  const units = usePrefs((s) => s.units);
  const lang = usePrefs((s) => s.lang);
  return (
    <div className="wk-live">
      <div className={`wk-status ${live.state}`}>
        <Icon name={live.type === 'run' ? 'zap' : 'footprints'} size={16} /> {t(`workout.type.${live.type}`)} · {live.state === 'paused' ? t('workout.paused') : t('workout.recording')}
      </div>
      <div className="wk-timer mono-num">{formatDuration(live.elapsedS)}</div>
      <div className="wk-big">
        <b className="mono-num">{distNum(live.distanceM, units)}</b>
        <span>{units === 'imperial' ? 'mi' : t('unit.km')}</span>
      </div>
      <div className="wk-grid">
        <div><small>{t('workout.pace_now')}</small><b className="mono-num">{paceText(live.currentPaceS, units)}</b><em>{paceUnit(units, t('unit.km'))}</em></div>
        <div><small>{t('workout.pace_avg')}</small><b className="mono-num">{paceText(live.avgPaceS, units)}</b><em>{paceUnit(units, t('unit.km'))}</em></div>
        <div><small>{t('workout.speed')}</small><b className="mono-num">{speedText(live.speed, units)}</b><em>{speedUnit(units, t('unit.kmh'))}</em></div>
        <div><small>{t('workout.kcal')}</small><b className="mono-num">{Math.round(live.calories)}</b><em>{t('unit.kcal')}</em></div>
        <div><small>{t('workout.area')}</small><b className="mono-num">{formatArea(live.corridorM2, units, lang).split(' ')[0]}</b><em>{formatArea(live.corridorM2, units, lang).split(' ')[1]}</em></div>
        <div><small>{t('workout.elev')}</small><b className="mono-num">{live.elevGainM === null ? '–' : Math.round(live.elevGainM)}</b><em>{t('unit.m')}</em></div>
      </div>
      <RouteSvg points={route} live height={180} ariaLabel={t('workout.route')} />
      {live.splits.length > 0 && (
        <div className="wk-splits-mini">
          {live.splits.slice(-3).map((s) => (
            <span key={s.km} className="chip solid" style={{ ['--c' as string]: 'var(--s1)' }}>
              {s.km} {t('unit.km')} · {paceText(s.paceS, units)}
            </span>
          ))}
        </div>
      )}
      <WorkoutControls />
      <p className="muted center wk-hint">{t('workout.nofog')}</p>
    </div>
  );
}

function WorkoutCard({ w }: { w: Workout }) {
  const { t, lang } = useT();
  const units = usePrefs((s) => s.units);
  const route = w.points.map((p): [number, number] => [p[0], p[1]]);
  return (
    <button className="wk-card" onClick={() => useApp.getState().patch({ sheet: { type: 'workout', id: w.id } })}>
      <span className="wk-thumb">
        <RouteSvg points={route} height={84} ariaLabel={t('workout.route')} />
      </span>
      <span className="wk-main">
        <span className="wk-title">
          <Icon name={w.type === 'run' ? 'zap' : 'footprints'} size={15} />
          <b>{t(`workout.type.${w.type}`)} · {distNum(w.distanceM, units)} {units === 'imperial' ? 'mi' : t('unit.km')}</b>
        </span>
        <small className="muted">{fmtDate(w.startedAt, lang, true)}</small>
        <span className="wk-meta">
          <small><Icon name="timer" size={12} /> {formatDuration(w.elapsedS)}</small>
          <small><Icon name="gauge" size={12} /> {paceText(w.avgPaceS, units)}{paceUnit(units, t('unit.km'))}</small>
          <small><Icon name="flame" size={12} /> {w.calories}</small>
        </span>
      </span>
    </button>
  );
}

export function WorkoutPage() {
  const { t, lang } = useT();
  const live = useApp((s) => s.workoutLive);
  const workouts = useApp((s) => s.workouts);
  const units = usePrefs((s) => s.units);
  const weight = usePrefs((s) => s.weightKg);
  const [type, setType] = useState<WorkoutType>('run');
  const gps = useApp((s) => s.gps);

  const today = dateKey();
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i - 6));
  const wkDay = (date: string) => workouts.filter((w) => dateKey(w.startedAt) === date);
  const conv = (m: number) => (units === 'imperial' ? m / 1609.344 : m / 1000);
  const weekData = week.map((d) => {
    const ws = wkDay(d);
    const walk = ws.filter((w) => w.type === 'walk').reduce((s, w) => s + w.distanceM, 0);
    const run = ws.filter((w) => w.type === 'run').reduce((s, w) => s + w.distanceM, 0);
    const label = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), 12).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'short' });
    return { label, parts: [conv(walk), conv(run)], tip: `${d.slice(8)}.${d.slice(5, 7)}: ${t('workout.type.walk')} ${conv(walk).toFixed(1)}, ${t('workout.type.run')} ${conv(run).toFixed(1)}` };
  });
  const weekWs = workouts.filter((w) => week.includes(dateKey(w.startedAt)));
  const wkDist = weekWs.reduce((s, w) => s + w.distanceM, 0);
  const wkTime = weekWs.reduce((s, w) => s + w.elapsedS, 0);
  const wkKcal = weekWs.reduce((s, w) => s + w.calories, 0);

  if (live) {
    return (
      <div className="page">
        <div className="page-scroll pad-top">
          <LiveView />
        </div>
      </div>
    );
  }
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('workout.title')}</h1>
          <p className="muted">{t('workout.sub')}</p>
        </div>
      </header>
      <div className="page-scroll">
        <div className="wk-start-card">
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'walk' as WorkoutType, label: <><Icon name="footprints" size={15} />&nbsp;{t('workout.type.walk')}</> },
              { value: 'run' as WorkoutType, label: <><Icon name="zap" size={15} />&nbsp;{t('workout.type.run')}</> },
            ]}
          />
          <button className="wk-go" onClick={() => workoutEngine.start(type)} aria-label={t('workout.start')}>
            <span className="wk-go-ring" />
            <Icon name="play" size={44} strokeWidth={2.2} />
            <b>{t('workout.start')}</b>
          </button>
          <div className="wk-info">
            <span><Icon name={gps === 'ok' ? 'locate' : 'locate-off'} size={14} /> {gps === 'ok' ? t('workout.gps_ok') : t('workout.gps_wait')}</span>
            <span><Icon name="user" size={14} /> {weight} {t('unit.kg')}</span>
          </div>
          <div className="wk-weight">
            <button className="icon-btn sm" aria-label="-" onClick={() => usePrefs.getState().set({ weightKg: Math.max(30, weight - 1) })}><Icon name="minus" size={14} /></button>
            <small>{t('workout.weight_hint')}</small>
            <button className="icon-btn sm" aria-label="+" onClick={() => usePrefs.getState().set({ weightKg: Math.min(250, weight + 1) })}><Icon name="plus" size={14} /></button>
          </div>
          <p className="muted center wk-hint">{t('workout.nofog')}</p>
        </div>

        {workouts.length > 0 && (
          <>
            <div className="kpi-row">
              <div className="kpi"><small>{t('workout.week_dist')}</small><b>{distNum(wkDist, units)} <em>{units === 'imperial' ? 'mi' : t('unit.km')}</em></b></div>
              <div className="kpi"><small>{t('workout.time')}</small><b className="mono-num">{formatDuration(wkTime)}</b></div>
              <div className="kpi"><small>{t('workout.kcal')}</small><b>{wkKcal}</b></div>
            </div>
            <ChartCard
              title={t('workout.week')}
              sub={units === 'imperial' ? 'mi' : t('unit.km')}
              legend={[{ color: 'var(--s1)', label: t('workout.type.walk') }, { color: 'var(--s5)', label: t('workout.type.run') }]}
              table={{ head: [t('stats.date'), t('workout.type.walk'), t('workout.type.run')], rows: weekData.map((d) => [d.label, d.parts[0].toFixed(2), d.parts[1].toFixed(2)]) }}
            >
              <BarChart data={weekData} colors={['var(--s1)', 'var(--s5)']} format={(v) => (v === 0 ? '0' : v < 10 ? String(+v.toFixed(1)) : String(Math.round(v)))} ariaLabel={t('workout.week')} height={130} />
            </ChartCard>
          </>
        )}

        <h3 className="sect">{t('workout.history')}</h3>
        {workouts.length === 0 ? (
          <div className="empty">
            <span className="empty-ic"><Icon name="zap" size={30} /></span>
            <b>{t('workout.empty_title')}</b>
            <p>{t('workout.empty_text')}</p>
          </div>
        ) : (
          <div className="wk-list">{workouts.map((w) => <WorkoutCard key={w.id} w={w} />)}</div>
        )}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
