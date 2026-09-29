import { useState } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { CountryPicker } from '../CountryPicker';
import { countryByCode, countryName } from '../../data/countries';
import { STATUSES, TRANSPORTS, addDaysKey, daysBetween, nights, todayKey, validateDates } from '../../core/trips';
import { saveTrip } from '../../state/trips';
import { TRANSPORT_ICON } from '../pages/TripsView';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'RUB', 'CHF', 'JPY', 'CNY', 'TRY', 'AED', 'THB', 'PLN', 'CZK', 'KZT', 'GEL', 'AMD', 'RSD'];

export function TripEditorSheet() {
  const { t, tn, lang } = useT();
  const draft = useApp((s) => s.tripDraft);
  const patch = useApp((s) => s.patch);
  const [picking, setPicking] = useState(false);
  if (!draft) return null;
  const isNew = !useApp.getState().trips.some((x) => x.id === draft.id);
  const set = (p: Partial<typeof draft>) => patch({ tripDraft: { ...draft, ...p } });
  const c = countryByCode(draft.country);
  const valid = validateDates(draft.startDate, draft.endDate);
  const close = () => patch({ sheet: isNew ? null : { type: 'trip', id: draft.id }, tripDraft: null });
  const setStart = (v: string) => {
    // если конец раньше начала или не задан — подтягиваем его
    const end = !draft.endDate || draft.endDate < v ? (v ? addDaysKey(v, 6) : '') : draft.endDate;
    set({ startDate: v, endDate: end, status: draft.status === 'idea' && v ? 'planned' : draft.status });
  };
  const quick = (n: number) => {
    const start = draft.startDate || addDaysKey(todayKey(), 14);
    set({ startDate: start, endDate: addDaysKey(start, n), status: draft.status === 'idea' ? 'planned' : draft.status });
  };
  const save = async () => {
    const title = draft.title.trim() || (c ? countryName(c, lang) : draft.destination.trim()) || t('trips.untitled');
    const saved = await saveTrip({ ...draft, title });
    patch({ tripDraft: null, sheet: { type: 'trip', id: saved.id } });
    useApp.getState().toast({ kind: 'info', title: t('trips.saved'), text: title, icon: 'check' });
  };

  if (picking) {
    return (
      <Sheet tall title={t('trips.pick_country')} onClose={() => setPicking(false)} back={() => setPicking(false)}>
        <CountryPicker selected={draft.country} onPick={(k) => { set({ country: k.code, currency: k.cur || draft.currency, title: draft.title || countryName(k, lang) }); setPicking(false); }} />
      </Sheet>
    );
  }

  return (
    <Sheet tall title={isNew ? t('trips.new') : t('trips.edit')} onClose={close} footer={
      <button className="btn primary block" disabled={valid !== 'ok'} onClick={() => void save()}><Icon name="check" size={18} /> {t('common.save')}</button>
    }>
      <div className="form">
        <div className="field">
          <span>{t('trips.country')}</span>
          <button className="pick-btn" onClick={() => setPicking(true)}>
            <span className="flag">{c?.flag ?? '🌍'}</span>
            <b>{c ? countryName(c, lang) : t('trips.choose_country')}</b>
            <Icon name="chevron-right" size={16} className="muted" />
          </button>
        </div>
        <label className="field"><span>{t('trips.name')}</span>
          <input className="input" value={draft.title} maxLength={60} placeholder={t('trips.name_ph')} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field"><span>{t('trips.destination')}</span>
          <input className="input" value={draft.destination} maxLength={60} placeholder={t('trips.destination_ph')} onChange={(e) => set({ destination: e.target.value })} />
        </label>

        <div className="field">
          <span>{t('trips.dates')}</span>
          <div className="date-row">
            <label><small className="muted">{t('trips.from')}</small><input type="date" className="input" value={draft.startDate} onChange={(e) => setStart(e.target.value)} /></label>
            <label><small className="muted">{t('trips.to')}</small><input type="date" className="input" min={draft.startDate || undefined} value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
          </div>
          <div className="chips-scroll tight">
            {[2, 6, 9, 13].map((n) => <button key={n} className="chip-btn" onClick={() => quick(n)}>{n} {tn('unit.night', n)}</button>)}
            {(draft.startDate || draft.endDate) && <button className="chip-btn" onClick={() => set({ startDate: '', endDate: '' })}><Icon name="x" size={13} /> {t('trips.clear_dates')}</button>}
          </div>
          {valid === 'order' && <small className="warn-text">{t('trips.err_order')}</small>}
          {valid === 'toolong' && <small className="warn-text">{t('trips.err_long')}</small>}
          {valid === 'ok' && draft.startDate && draft.endDate && <small className="muted">{daysBetween(draft.startDate, draft.endDate) + 1} {tn('unit.day', daysBetween(draft.startDate, draft.endDate) + 1)} · {nights(draft)} {tn('unit.night', nights(draft))}</small>}
        </div>

        <div className="field">
          <span>{t('trips.status_l')}</span>
          <div className="chips-scroll tight wrap-l">
            {STATUSES.map((s) => <button key={s} className={`chip-btn ${draft.status === s ? 'on' : ''}`} onClick={() => set({ status: s })}>{t(`trips.status.${s}`)}</button>)}
          </div>
        </div>
        <div className="field">
          <span>{t('trips.transport')}</span>
          <div className="cat-grid four">
            {TRANSPORTS.map((k) => (
              <button key={k} className={`cat ${draft.transport === k ? 'on' : ''}`} style={{ ['--c' as string]: 'var(--s1)' }} onClick={() => set({ transport: k })}>
                <Icon name={TRANSPORT_ICON[k]} size={18} /><small>{t(`trips.tr.${k}`)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="two-fields">
          <div className="field">
            <span>{t('trips.travelers')}</span>
            <div className="stepper">
              <button className="icon-btn sm" onClick={() => set({ travelers: Math.max(1, draft.travelers - 1) })}><Icon name="minus" size={14} /></button>
              <b>{draft.travelers}</b>
              <button className="icon-btn sm" onClick={() => set({ travelers: Math.min(30, draft.travelers + 1) })}><Icon name="plus" size={14} /></button>
            </div>
          </div>
          <label className="field"><span>{t('trips.currency')}</span>
            <select className="input" value={draft.currency} onChange={(e) => set({ currency: e.target.value })}>
              {[...new Set([draft.currency, ...CURRENCIES])].map((cur) => <option key={cur}>{cur}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>{t('trips.budget')}</span>
          <input className="input" type="number" inputMode="decimal" min={0} value={draft.budget || ''} placeholder="0" onChange={(e) => set({ budget: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="field"><span>{t('trips.notes')}</span>
          <textarea className="input" rows={3} value={draft.notes} placeholder={t('trips.notes_ph')} onChange={(e) => set({ notes: e.target.value })} />
        </label>
      </div>
    </Sheet>
  );
}
