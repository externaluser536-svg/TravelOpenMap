import { useMemo, useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Segmented } from '../common';
import { BarChart, ChartCard, Donut, HBars, Heatmap, LineArea } from '../charts';
import { calendarHeat, categoryBreakdown, cumulative, deltaVsPrevious, series, sum, weekdayAverages, type Period } from '../../core/stats';
import { dateKey } from '../../core/days';
import { formatArea, formatDistance } from '../../core/geo';
import { GROUP_ORDER } from '../../core/challenges';
import { formatDuration } from '../../core/workout';

const S = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

function Stat({ icon, value, label, tone }: { icon: string; value: string; label: string; tone: string }) {
  return (
    <div className="stat" style={{ ['--c' as string]: tone }}>
      <span className="stat-ic">
        <Icon name={icon} size={18} />
      </span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Delta({ v }: { v: number | null }) {
  const { t } = useT();
  if (v === null) return <small className="muted delta">{t('stats.no_prev')}</small>;
  const up = v >= 0;
  return (
    <small className="delta">
      <Icon name={up ? 'trend-up' : 'trend-down'} size={13} />
      {up ? '+' : '−'}
      {Math.abs(Math.round(v * 100))}%
    </small>
  );
}

export function StatsView() {
  const { t, lang, tn } = useT();
  const units = usePrefs((s) => s.units);
  const stats = useApp((s) => s.stats);
  const days = useApp((s) => s.allDays);
  const hours = useApp((s) => s.hours);
  const notes = useApp((s) => s.notes);
  const challenges = useApp((s) => s.challenges);
  const workouts = useApp((s) => s.workouts);
  const [period, setPeriod] = useState<Period>(30);
  const today = dateKey();
  const imperial = units === 'imperial';
  const loc = lang === 'ru' ? 'ru-RU' : 'en-GB';

  const win = useMemo(() => series(days, today, period), [days, today, period]);
  const distUnit = imperial ? 'mi' : t('unit.km');
  const areaUnit = imperial ? 'mi²' : t('unit.km2');
  const toDist = (m: number) => (imperial ? m / 1609.344 : m / 1000);
  const toArea = (m2: number) => (imperial ? m2 / 2589988.11 : m2 / 1e6);
  const short = (x: number) => (x === 0 ? '0' : x < 10 ? String(+x.toFixed(1)) : String(Math.round(x)));
  const dayLabel = (d: string) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), 12).toLocaleDateString(loc, { day: 'numeric', month: 'short' });
  const weekdayShort = (i: number) => new Date(2024, 0, 1 + i, 12).toLocaleDateString(loc, { weekday: 'short' }); // 1 янв 2024 — понедельник

  const totals = {
    dist: sum(win, 'distanceM'),
    area: sum(win, 'areaM2'),
    notes: sum(win, 'notes'),
    wk: win.reduce((s, d) => s + (d.workoutM ?? 0), 0),
  };
  const prevOk = period !== 0;
  const dDist = prevOk ? deltaVsPrevious(days, today, period as 7 | 30 | 90, 'distanceM') : null;
  const dArea = prevOk ? deltaVsPrevious(days, today, period as 7 | 30 | 90, 'areaM2') : null;
  const dNotes = prevOk ? deltaVsPrevious(days, today, period as 7 | 30 | 90, 'notes') : null;

  const labelEvery = win.length <= 8 ? 1 : win.length <= 31 ? 5 : Math.ceil(win.length / 6);
  const barData = win.map((d) => ({
    label: String(+d.date.slice(8)),
    parts: [toDist(d.distanceM), toDist(d.workoutM ?? 0)],
    tip: `${dayLabel(d.date)}: ${short(toDist(d.distanceM))} ${distUnit}${(d.workoutM ?? 0) > 0 ? ` · ${t('stats.workouts_s')} ${short(toDist(d.workoutM ?? 0))} ${distUnit}` : ''}`,
  }));
  const areaBase = stats.areaM2 - days.reduce((a, d) => a + d.areaM2, 0);
  const cum = cumulative(days, win, 'areaM2', areaBase).map(toArea);
  const wd = weekdayAverages(days.filter((d) => d.distanceM + (d.workoutM ?? 0) > 0));
  const wdData = wd.map((v, i) => ({ label: weekdayShort(i), parts: [toDist(v)], tip: `${weekdayShort(i)}: ${short(toDist(v))} ${distUnit}` }));
  const hourData = hours.map((m, h) => ({ label: h % 6 === 0 ? String(h) : '', parts: [m], tip: `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · ${Math.round(m)} ${t('unit.min')}` }));
  const hasHours = hours.some((h) => h > 0.5);
  const heat = useMemo(() => calendarHeat(days, today, 13), [days, today]);

  const cats = categoryBreakdown(notes);
  const top = cats.slice(0, 5);
  const rest = cats.slice(5).reduce((s, c) => s + c.count, 0);
  const slices = [
    ...top.map((c, i) => ({ label: t(`cat.${c.category}`), value: c.count, color: S[i] })),
    ...(rest ? [{ label: t('stats.other'), value: rest, color: 'var(--muted)' }] : []),
  ];

  const groups = GROUP_ORDER.map((g) => {
    const items = challenges.filter((c) => c.def.group === g);
    const done = items.filter((c) => c.done).length;
    return { label: t(`group.${g}`), value: done, max: items.length, text: `${done}/${items.length}` };
  }).filter((g) => g.max > 0);

  const wkTotal = workouts.reduce((s, w) => s + w.elapsedS, 0);

  return (
    <>
      <div className="stat-grid">
        <Stat icon="map" value={formatArea(stats.areaM2, units, lang)} label={t('stat.area')} tone="var(--s3)" />
        <Stat icon="footprints" value={formatDistance(stats.distanceM, units, lang)} label={t('stat.distance')} tone="var(--s1)" />
        <Stat icon="pin" value={String(stats.notes)} label={tn('unit.note', stats.notes)} tone="var(--s2)" />
        <Stat icon="zap" value={String(stats.workouts)} label={t('stat.workouts')} tone="var(--s5)" />
        <Stat icon="calendar" value={String(stats.activeDays)} label={t('stat.days')} tone="var(--s4)" />
        <Stat icon="flame" value={String(stats.bestStreak)} label={t('stat.best_streak')} tone="var(--s2)" />
      </div>

      <div className="period-row">
        <h3 className="sect">{t('stats.dynamics')}</h3>
        <Segmented
          value={period}
          onChange={setPeriod}
          options={[
            { value: 7 as Period, label: t('stats.p7') },
            { value: 30 as Period, label: t('stats.p30') },
            { value: 90 as Period, label: t('stats.p90') },
            { value: 0 as Period, label: t('stats.pall') },
          ]}
        />
      </div>

      <div className="kpi-row">
        <div className="kpi">
          <small>{t('stats.walked')}</small>
          <b>{short(toDist(totals.dist))} <em>{distUnit}</em></b>
          <Delta v={dDist} />
        </div>
        <div className="kpi">
          <small>{t('stats.revealed')}</small>
          <b>{toArea(totals.area) < 0.1 ? toArea(totals.area).toFixed(2) : short(toArea(totals.area))} <em>{areaUnit}</em></b>
          <Delta v={dArea} />
        </div>
        <div className="kpi">
          <small>{t('stats.notes_p')}</small>
          <b>{totals.notes}</b>
          <Delta v={dNotes} />
        </div>
      </div>

      <ChartCard
        title={t('stats.by_day')}
        sub={distUnit}
        legend={[{ color: S[0], label: t('stats.exploring') }, { color: S[4], label: t('stats.workouts_s') }]}
        table={{
          head: [t('stats.date'), `${t('stats.exploring')}, ${distUnit}`, `${t('stats.workouts_s')}, ${distUnit}`],
          rows: win.filter((d) => d.distanceM + (d.workoutM ?? 0) > 0).map((d) => [dayLabel(d.date), short(toDist(d.distanceM)), short(toDist(d.workoutM ?? 0))]),
        }}
      >
        <BarChart data={barData} colors={[S[0], S[4]]} format={short} ariaLabel={t('stats.by_day')} labelEvery={labelEvery} />
      </ChartCard>

      <ChartCard
        title={t('stats.cum_area')}
        sub={areaUnit}
        table={{ head: [t('stats.date'), areaUnit], rows: win.filter((_, i) => i % Math.max(1, Math.round(win.length / 12)) === 0 || i === win.length - 1).map((d, _i) => [dayLabel(d.date), cum[win.indexOf(d)].toFixed(3)]) }}
      >
        <LineArea
          values={cum}
          labels={win.map((d) => dayLabel(d.date))}
          tips={win.map((d, i) => `${dayLabel(d.date)}: ${cum[i].toFixed(cum[i] < 1 ? 3 : 2)} ${areaUnit}`)}
          color={S[2]}
          format={(v) => (v === 0 ? '0' : v < 1 ? v.toFixed(2) : short(v))}
          ariaLabel={t('stats.cum_area')}
        />
      </ChartCard>

      <ChartCard title={t('stats.calendar')} sub={t('stats.calendar_sub')} table={{ head: [t('stats.date'), distUnit], rows: heat.flat().filter((c) => c.value > 0 && !c.future).map((c) => [dayLabel(c.date), short(toDist(c.value))]) }}>
        <Heatmap
          weeks={heat}
          ariaLabel={t('stats.calendar')}
          dayLabels={[0, 1, 2, 3, 4, 5, 6].map(weekdayShort)}
          tip={(c) => `${dayLabel(c.date)}: ${c.value > 0 ? `${short(toDist(c.value))} ${distUnit}` : t('stats.rest')}`}
          legend={[t('stats.less'), t('stats.more')]}
        />
      </ChartCard>

      <div className="two-col">
        <ChartCard title={t('stats.weekdays')} sub={t('stats.avg') + ', ' + distUnit}>
          <BarChart data={wdData} colors={[S[0]]} format={short} ariaLabel={t('stats.weekdays')} height={130} />
        </ChartCard>
        {hasHours && (
          <ChartCard title={t('stats.hours')} sub={t('unit.min')}>
            <BarChart data={hourData} colors={[S[1]]} format={(v) => String(Math.round(v))} ariaLabel={t('stats.hours')} height={130} labelEvery={6} />
          </ChartCard>
        )}
      </div>

      {slices.length > 0 && (
        <ChartCard title={t('stats.categories')} sub={`${notes.length} ${tn('unit.note', notes.length)}`}>
          <Donut slices={slices} center={{ big: String(notes.length), small: tn('unit.note', notes.length) }} ariaLabel={t('stats.categories')} />
        </ChartCard>
      )}

      {workouts.length > 0 && (
        <div className="card wk-sum">
          <span className="ws-ic">
            <Icon name="zap" size={20} />
          </span>
          <div>
            <b>{t('stats.workouts_total', { n: workouts.length, dist: formatDistance(stats.workoutDistanceM, units, lang), time: formatDuration(wkTotal) })}</b>
            <small className="muted">{t('stats.workouts_hint')}</small>
          </div>
        </div>
      )}

      <ChartCard title={t('stats.challenges')} sub={t('stats.challenges_sub')}>
        <HBars rows={groups} color={S[2]} />
      </ChartCard>
    </>
  );
}
