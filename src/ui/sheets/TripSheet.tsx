import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Bar, Sheet } from '../common';
import { Donut } from '../charts';
import { Countdown, TRANSPORT_ICON, fmtRange, money } from '../pages/TripsView';
import { countryByCode, countryName } from '../../data/countries';
import { CHECKLIST_TEMPLATE, EXPENSE_CATEGORIES, budgetState, checklistProgress, expensesByCategory, hasDates, nights, tripDays } from '../../core/trips';
import { removeTrip, saveTrip } from '../../state/trips';
import { uid, type ExpenseCategory, type Trip } from '../../data/db';
import { loadCatalog } from '../../map/maps';
import { activateMap } from '../../state/actions';

type Tab = 'overview' | 'plan' | 'check' | 'budget';
const CAT_COLOR: Record<ExpenseCategory, string> = { transport: 'var(--s1)', stay: 'var(--s2)', food: 'var(--s3)', fun: 'var(--s4)', shopping: 'var(--s5)', other: 'var(--muted)' };

export function TripSheet({ id }: { id: string }) {
  const { t, lang, tn } = useT();
  const trip = useApp((s) => s.trips.find((x) => x.id === id));
  const patch = useApp((s) => s.patch);
  const [tab, setTab] = useState<Tab>('overview');
  const [confirm, setConfirm] = useState(false);
  if (!trip) return null;
  const c = countryByCode(trip.country);
  const update = (p: Partial<Trip>) => void saveTrip({ ...trip, ...p });

  const openCountryMap = async () => {
    if (!c) return;
    const own = (await loadCatalog()).find((m) => m.country === c.code);
    if (own) {
      await activateMap(own.id);
      patch({ sheet: null, screen: 'map', follow: false });
    } else {
      patch({ sheet: { type: 'country', code: c.code } });
    }
  };

  return (
    <Sheet tall onClose={() => patch({ sheet: null })} title={<span className="country-title"><span className="flag big">{c?.flag ?? '🧭'}</span>{trip.title}</span>}>
      <div className="note-detail">
        <div className="trip-hero">
          <Countdown trip={trip} />
          <span className={`status-chip s-${trip.status}`}>{t(`trips.status.${trip.status}`)}</span>
          {hasDates(trip) && <small className="muted"><Icon name="calendar-days" size={12} /> {fmtRange(trip, lang)} · {nights(trip)} {tn('unit.night', nights(trip))}</small>}
          <small className="muted"><Icon name={TRANSPORT_ICON[trip.transport]} size={12} /> {t(`trips.tr.${trip.transport}`)} · <Icon name="users" size={12} /> {trip.travelers}</small>
        </div>
        <div className="seg wide" role="tablist">
          {(['overview', 'plan', 'check', 'budget'] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} role="tab" aria-selected={tab === k}>{t(`trips.tab.${k}`)}</button>
          ))}
        </div>
        {tab === 'overview' && <Overview trip={trip} update={update} onMap={openCountryMap} country={c ? countryName(c, lang) : ''} />}
        {tab === 'plan' && <Plan trip={trip} update={update} />}
        {tab === 'check' && <Checklist trip={trip} update={update} />}
        {tab === 'budget' && <Budget trip={trip} update={update} />}

        <div className="action-grid">
          <button className="btn ghost" onClick={() => patch({ tripDraft: trip, sheet: { type: 'tripEditor' } })}><Icon name="pencil" size={16} /> {t('common.edit')}</button>
          {confirm ? (
            <button className="btn danger" onClick={() => { void removeTrip(trip.id); patch({ sheet: null }); }}>{t('common.delete')}?</button>
          ) : (
            <button className="btn ghost danger-text" onClick={() => setConfirm(true)}><Icon name="trash" size={16} /> {t('common.delete')}</button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Overview({ trip, update, onMap, country }: { trip: Trip; update: (p: Partial<Trip>) => void; onMap: () => void; country: string }) {
  const { t, lang } = useT();
  const cl = checklistProgress(trip.checklist);
  const b = budgetState(trip);
  const days = tripDays(trip);
  const planned = new Set(trip.items.map((i) => i.date)).size;
  return (
    <>
      <div className="wk-cells">
        <div className="wk-cell"><small><Icon name="map-pinned" size={12} /> {t('trips.destination')}</small><b className="sm">{trip.destination || country || '–'}</b></div>
        <div className="wk-cell"><small><Icon name="list" size={12} /> {t('trips.tab.check')}</small><b className="mono-num">{cl.done}/{cl.total}</b></div>
        <div className="wk-cell"><small><Icon name="wallet" size={12} /> {t('trips.tab.budget')}</small><b className="mono-num">{trip.budget ? `${Math.round(b.ratio * 100)}%` : '–'}</b></div>
        <div className="wk-cell"><small><Icon name="calendar-days" size={12} /> {t('trips.tab.plan')}</small><b className="mono-num">{days.length ? `${planned}/${days.length}` : '–'}</b></div>
      </div>
      <div className="field">
        <span>{t('trips.status_l')}</span>
        <div className="chips-scroll tight wrap-l">
          {(['idea', 'planned', 'booked', 'done', 'cancelled'] as const).map((s) => <button key={s} className={`chip-btn ${trip.status === s ? 'on' : ''}`} onClick={() => update({ status: s })}>{t(`trips.status.${s}`)}</button>)}
        </div>
      </div>
      {trip.notes && <p className="note-text">{trip.notes}</p>}
      {trip.country && (
        <button className="btn ghost block" onClick={onMap}><Icon name="map" size={16} /> {t('trips.country_map')}</button>
      )}
      {trip.budget > 0 && <small className="muted center">{t('trips.per_person')}: {money(b.perPerson, trip.currency, lang)}</small>}
    </>
  );
}

function Plan({ trip, update }: { trip: Trip; update: (p: Partial<Trip>) => void }) {
  const { t, lang } = useT();
  const days = tripDays(trip);
  const [adding, setAdding] = useState<string | null>(null);
  const [f, setF] = useState({ time: '', title: '', place: '' });
  if (!days.length) return <div className="empty compact"><b>{t('trips.plan_nodates')}</b><p>{t('trips.plan_nodates_text')}</p></div>;
  const add = (date: string) => {
    if (!f.title.trim()) return;
    update({ items: [...trip.items, { id: uid(), date, time: f.time || undefined, title: f.title.trim(), place: f.place.trim() || undefined }] });
    setF({ time: '', title: '', place: '' });
    setAdding(null);
  };
  return (
    <div className="plan">
      {days.map((d, i) => {
        const items = trip.items.filter((x) => x.date === d).sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99'));
        const label = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), 12).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return (
          <section key={d} className="plan-day">
            <header><b>{t('trips.day')} {i + 1}</b><small className="muted">{label}</small>
              <button className="icon-btn sm" onClick={() => setAdding(adding === d ? null : d)} aria-label={t('trips.add_item')}><Icon name={adding === d ? 'x' : 'plus'} size={14} /></button>
            </header>
            {items.map((it) => (
              <div key={it.id} className={`plan-item ${it.done ? 'done' : ''}`}>
                <button className={`check ${it.done ? 'on' : ''}`} onClick={() => update({ items: trip.items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })} aria-label="done">{it.done && <Icon name="check" size={13} strokeWidth={3.4} />}</button>
                <div className="pi-main"><b>{it.title}</b>{(it.time || it.place) && <small className="muted">{[it.time, it.place].filter(Boolean).join(' · ')}</small>}</div>
                <button className="icon-btn sm ghosty" onClick={() => update({ items: trip.items.filter((x) => x.id !== it.id) })} aria-label={t('common.delete')}><Icon name="x" size={13} /></button>
              </div>
            ))}
            {items.length === 0 && adding !== d && <small className="muted pad-l">{t('trips.day_empty')}</small>}
            {adding === d && (
              <div className="add-form">
                <input className="input" value={f.title} placeholder={t('trips.item_title')} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />
                <div className="two-fields">
                  <input className="input" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} />
                  <input className="input" value={f.place} placeholder={t('trips.item_place')} onChange={(e) => setF({ ...f, place: e.target.value })} />
                </div>
                <button className="btn primary sm" onClick={() => add(d)}><Icon name="check" size={14} /> {t('common.save')}</button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Checklist({ trip, update }: { trip: Trip; update: (p: Partial<Trip>) => void }) {
  const { t } = useT();
  const [text, setText] = useState('');
  const p = checklistProgress(trip.checklist);
  const fill = () => update({ checklist: CHECKLIST_TEMPLATE.flatMap((g) => g.keys.map((k) => ({ id: uid(), text: t(`check.${k}`), done: false, group: g.group }))) });
  const groups = [...new Set(trip.checklist.map((x) => x.group))];
  return (
    <>
      {trip.checklist.length === 0 ? (
        <div className="empty compact"><b>{t('trips.check_empty')}</b><button className="btn primary sm" onClick={fill}><Icon name="list" size={14} /> {t('trips.check_template')}</button></div>
      ) : (
        <div className="check-prog"><Bar value={p.ratio} /><small className="muted">{p.done}/{p.total}</small></div>
      )}
      {groups.map((g) => (
        <section key={g} className="check-group">
          <h4 className="sect-sm">{t(`checkg.${g}`)}</h4>
          {trip.checklist.filter((x) => x.group === g).map((it) => (
            <div key={it.id} className={`plan-item ${it.done ? 'done' : ''}`}>
              <button className={`check ${it.done ? 'on' : ''}`} onClick={() => update({ checklist: trip.checklist.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)) })} aria-label="done">{it.done && <Icon name="check" size={13} strokeWidth={3.4} />}</button>
              <div className="pi-main"><b>{it.text}</b></div>
              <button className="icon-btn sm ghosty" onClick={() => update({ checklist: trip.checklist.filter((x) => x.id !== it.id) })} aria-label={t('common.delete')}><Icon name="x" size={13} /></button>
            </div>
          ))}
        </section>
      ))}
      <form className="add-line" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { update({ checklist: [...trip.checklist, { id: uid(), text: text.trim(), done: false, group: 'misc' }] }); setText(''); } }}>
        <input className="input" value={text} placeholder={t('trips.check_add')} onChange={(e) => setText(e.target.value)} />
        <button className="btn primary sm" type="submit" disabled={!text.trim()}><Icon name="plus" size={16} /></button>
      </form>
    </>
  );
}

function Budget({ trip, update }: { trip: Trip; update: (p: Partial<Trip>) => void }) {
  const { t, lang } = useT();
  const units = usePrefs((s) => s.units);
  void units;
  const b = budgetState(trip);
  const [f, setF] = useState({ title: '', amount: '', category: 'other' as ExpenseCategory });
  const byCat = expensesByCategory(trip.expenses);
  const add = () => {
    const amount = Number(f.amount);
    if (!f.title.trim() || !(amount > 0)) return;
    update({ expenses: [{ id: uid(), title: f.title.trim(), amount, category: f.category }, ...trip.expenses] });
    setF({ title: '', amount: '', category: f.category });
  };
  return (
    <>
      <div className="card budget-card">
        <div className="bd-row"><small className="muted">{t('trips.spent')}</small><b>{money(b.spent, trip.currency, lang)}</b></div>
        {trip.budget > 0 ? (
          <>
            <div className="bar thin"><i style={{ width: `${Math.min(100, b.ratio * 100)}%`, background: b.over ? 'var(--s2)' : 'var(--s3)' }} /></div>
            <div className="bd-row"><small className={b.over ? 'warn-text' : 'muted'}>{b.over ? `${t('trips.over')} ${money(-b.left, trip.currency, lang)}` : `${t('trips.left')} ${money(b.left, trip.currency, lang)}`}</small><small className="muted">{t('trips.budget')} {money(trip.budget, trip.currency, lang)}</small></div>
          </>
        ) : <small className="muted">{t('trips.no_budget')}</small>}
      </div>
      {byCat.length > 0 && (
        <div className="card">
          <Donut slices={byCat.map((c) => ({ label: t(`exp.${c.category}`), value: Math.round(c.amount), color: CAT_COLOR[c.category] }))} center={{ big: money(b.spent, trip.currency, lang), small: t('trips.spent') }} ariaLabel={t('trips.spent')} />
        </div>
      )}
      <div className="add-form">
        <input className="input" value={f.title} placeholder={t('trips.exp_title')} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <div className="two-fields">
          <input className="input" type="number" inputMode="decimal" min={0} value={f.amount} placeholder={trip.currency} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as ExpenseCategory })}>
            {EXPENSE_CATEGORIES.map((k) => <option key={k} value={k}>{t(`exp.${k}`)}</option>)}
          </select>
        </div>
        <button className="btn primary sm" onClick={add} disabled={!f.title.trim() || !(Number(f.amount) > 0)}><Icon name="plus" size={14} /> {t('trips.exp_add')}</button>
      </div>
      {trip.expenses.map((e) => (
        <div key={e.id} className="plan-item">
          <span className="dot" style={{ background: CAT_COLOR[e.category] }} />
          <div className="pi-main"><b>{e.title}</b><small className="muted">{t(`exp.${e.category}`)}</small></div>
          <b className="mono-num">{money(e.amount, trip.currency, lang)}</b>
          <button className="icon-btn sm ghosty" onClick={() => update({ expenses: trip.expenses.filter((x) => x.id !== e.id) })} aria-label={t('common.delete')}><Icon name="x" size={13} /></button>
        </div>
      ))}
    </>
  );
}
