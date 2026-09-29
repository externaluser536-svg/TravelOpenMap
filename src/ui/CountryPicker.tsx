import { useMemo, useState, type ReactNode } from 'react';
import { REGIONS, countryName, searchCountries, type Country } from '../data/countries';
import { useT } from '../i18n';
import { Icon } from './icons';

/** Поиск и выбор страны: строка поиска, фильтр по части света, список с флагами. */
export function CountryPicker({
  onPick,
  selected,
  badge,
  maxHeight,
}: {
  onPick: (c: Country) => void;
  selected?: string;
  badge?: (c: Country) => ReactNode;
  maxHeight?: number | string;
}) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const list = useMemo(() => searchCountries(q, lang, region), [q, lang, region]);
  return (
    <div className="picker">
      <div className="search">
        <Icon name="search" size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('countries.search')} autoComplete="off" />
      </div>
      <div className="chips-scroll tight">
        <button className={`chip-btn ${region === null ? 'on' : ''}`} onClick={() => setRegion(null)}>{t('notes.all')}</button>
        {REGIONS.map((r) => (
          <button key={r} className={`chip-btn ${region === r ? 'on' : ''}`} onClick={() => setRegion(region === r ? null : r)}>
            {t(`region.${r}`)}
          </button>
        ))}
      </div>
      <ul className="country-list" style={maxHeight ? { maxHeight } : undefined}>
        {list.map((c) => (
          <li key={c.code}>
            <button className={`country-row ${selected === c.code ? 'on' : ''}`} onClick={() => onPick(c)}>
              <span className="flag">{c.flag}</span>
              <span className="cr-main">
                <b>{countryName(c, lang)}</b>
                <small>{t(`region.${c.region}`)}{lang === 'en' && c.sub ? ` · ${c.sub}` : ''}</small>
              </span>
              {badge?.(c)}
              <Icon name="chevron-right" size={16} className="muted" />
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted center pad">{t('notes.none_found')}</li>}
      </ul>
    </div>
  );
}
