import { useMemo } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Bar } from '../common';
import { countryByCode, countryName } from '../../data/countries';
import { budgetState, checklistProgress, daysBetween, daysUntil, groupTrips, hasDates, nights, phaseOf, timelineBars, todayKey } from '../../core/trips';
import type { Trip } from '../../data/db';
import { draftTrip } from '../../state/trips';

export const TRANSPORT_ICON: Record<string, string> = { plane: 'plane', train: 'train-front', car: 'car', bus: 'bus', ship: 'ship', bike: 'bike', other: 'luggage' };

export function money(v: number, cur: string, lang: string): string {
  try {
    return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-GB', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 }).format(v);
  } catch {
    return `${Math.round(v)} ${cur}`;
  }
}

export function fmtRange(t: Pick<Trip, 'startDate' | 'endDate'>, lang: string): string {
  if (!hasDates(t)) return '';
  const f = (d: string, withYear: boolean) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), 12).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  const sameYear = t.startDate.slice(0, 4) === t.endDate.slice(0, 4);
  return `${f(t.startDate, !sameYear)} — ${f(t.endDate, true)}`;
}

export function Countdown({ trip }: { trip: Trip }) {
  const { t, tn } = useT();
  const phase = phaseOf(trip);
  const n = daysUntil(trip);
  if (phase === 'undated') return <span className="cd-chip idle">{t('trips.no_dates')}</span>;
  if (phase === 'ongoing') return <span className="cd-chip live">{t('trips.ongoing')}</span>;
  if (phase === 'past') return <span className="cd-chip past">{t('trips.finished')}</span>;
  return <span className="cd-chip">{n === 0 ? t('trips.today') : n === 1 ? t('trips.tomorrow') : `${t('trips.in')} ${n} ${tn('unit.day', n ?? 0)}`}</span>;
}

function TripCard({ trip }: { trip: Trip }) {
  const { t, lang, tn } = useT();
  const c = countryByCode(trip.country);
  const cl = checklistProgress(trip.checklist);
  const b = budgetState(trip);
  return (
    <button className={`trip-card ${trip.status === 'cancelled' ? 'dim' : ''}`} onClick={() => useApp.getState().patch({ sheet: { type: 'trip', id: trip.id } })}>
      <span className="tc-flag">{c?.flag ?? '🧭'}</span>
      <span className="tc-main">
        <span className="tc-top">
          <b>{trip.title || t('trips.untitled')}</b>
          <Countdown trip={trip} />
        </span>
        <small className="muted">
          {[c ? countryName(c, lang) : '', trip.destination].filter(Boolean).join(' · ') || t('trips.no_place')}
        </small>
        <span className="tc-meta">
          {hasDates(trip) && (
            <small><Icon name="calendar-days" size={12} /> {fmtRange(trip, lang)} · {nights(trip)} {tn('unit.night', nights(trip))}</small>
          )}
        </span>
        <span className="tc-chips">
          <span className={`status-chip s-${trip.status}`}>{t(`trips.status.${trip.status}`)}</span>
          <small><Icon name={TRANSPORT_ICON[trip.transport]} size={12} /></small>
          {cl.total > 0 && <small><Icon name="list" size={12} /> {cl.done}/{cl.total}</small>}
          {trip.budget > 0 && <small className={b.over ? 'warn-text' : ''}><Icon name="wallet" size={12} /> {money(b.spent, trip.currency, lang)} / {money(trip.budget, trip.currency, lang)}</small>}
        </span>
        {cl.total > 0 && <Bar value={cl.ratio} />}
      </span>
    </button>
  );
}

/** Скользящая шкала на 12 месяцев вперёд от текущего; над полосами — флаги стран. */
function YearTimeline({ trips }: { trips: Trip[] }) {
  const { lang } = useT();
  const now = new Date();
  const start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const endD = new Date(now.getFullYear(), now.getMonth() + 12, 1, 12);
  const span = Math.round((endD.getTime() - new Date(now.getFullYear(), now.getMonth(), 1, 12).getTime()) / 86400000);
  const bars = useMemo(() => timelineBars(trips, start, span), [trips, start, span]);
  const today = todayKey();
  const nowX = daysBetween(start, today) / span;
  const W = 340;
  const X = (f: number) => 4 + f * (W - 8);
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1, 12);
    return { label: d.toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'narrow' }), from: daysBetween(start, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`) / span, jan: d.getMonth() === 0, year: d.getFullYear() };
  });
  return (
    <div className="card timeline chart-wrap">
      <svg viewBox={`0 0 ${W} 92`} width="100%" role="img" aria-label="timeline">
        {months.map((m, i) => (
          <g key={i}>
            <line x1={X(m.from)} x2={X(m.from)} y1={4} y2={68} className="grid" />
            <text x={X(m.from) + 10} y={86} textAnchor="middle" className="tick">{m.label}</text>
            {(i === 0 || m.jan) && <text x={X(m.from) + 3} y={12} className="tick strong">{m.year}</text>}
          </g>
        ))}
        {bars.map((b, i) => {
          const t = trips.find((x) => x.id === b.id)!;
          const y = 30 + (i % 3) * 13;
          const w = Math.max(9, (b.to - b.from) * (W - 8));
          return (
            <g key={b.id}>
              <text x={X(b.from)} y={y - 3} fontSize="11">{countryByCode(t.country)?.flag ?? ''}</text>
              <rect x={X(b.from)} y={y} width={w} height={9} rx={4.5} fill={t.status === 'idea' ? 'var(--s4)' : t.status === 'done' ? 'var(--muted)' : 'var(--s1)'} opacity={t.status === 'idea' ? 0.6 : 1} />
            </g>
          );
        })}
        {nowX >= 0 && nowX <= 1 && <line x1={X(nowX)} x2={X(nowX)} y1={16} y2={68} stroke="var(--s2)" strokeWidth={2} strokeLinecap="round" />}
      </svg>
    </div>
  );
}

export function TripsView() {
  const { t } = useT();
  const trips = useApp((s) => s.trips);
  const g = useMemo(() => groupTrips(trips), [trips]);
  const newTripAction = () => useApp.getState().patch({ tripDraft: draftTrip(), sheet: { type: 'tripEditor' } });
  const section = (title: string, list: Trip[]) =>
    list.length ? (
      <>
        <h3 className="sect">{title}</h3>
        <div className="trip-list">{list.map((x) => <TripCard key={x.id} trip={x} />)}</div>
      </>
    ) : null;
  return (
    <>
      <div className="trips-head">
        <div>
          <h3 className="sect nomargin">{t('trips.title')}</h3>
          <small className="muted">{t('trips.sub')}</small>
        </div>
        <button className="round-add" onClick={newTripAction} aria-label={t('trips.new')}><Icon name="plus" size={22} strokeWidth={2.6} /></button>
      </div>
      {trips.length > 0 && <YearTimeline trips={trips} />}
      {trips.length === 0 ? (
        <div className="empty">
          <span className="empty-ic"><Icon name="plane" size={30} /></span>
          <b>{t('trips.empty_title')}</b>
          <p>{t('trips.empty_text')}</p>
          <button className="btn primary" onClick={newTripAction}><Icon name="plus" size={16} /> {t('trips.new')}</button>
        </div>
      ) : (
        <>
          {section(t('trips.g.ongoing'), g.ongoing)}
          {section(t('trips.g.upcoming'), g.upcoming)}
          {section(t('trips.g.ideas'), g.ideas)}
          {section(t('trips.g.past'), g.past)}
        </>
      )}
    </>
  );
}
