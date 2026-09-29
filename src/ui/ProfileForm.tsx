import { useState } from 'react';
import { usePrefs, type ThemePref } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { CountryPicker } from './CountryPicker';
import { countryByCode, countryName } from '../data/countries';
import { AVATAR_COLORS, AVATAR_ICONS, NICK_MAX, checkNickname, suggestAvatar, type NickCheck } from '../core/profile';

export interface ProfileValue {
  nickname: string;
  avatarIcon: string;
  avatarColor: string;
  homeCountry: string;
  weightKg: number;
}

export function Avatar({ icon, color, size = 56 }: { icon: string; color: string; size?: number }) {
  return (
    <span className="avatar" style={{ ['--c' as string]: color, width: size, height: size }}>
      <Icon name={icon} size={Math.round(size * 0.5)} strokeWidth={2.1} />
    </span>
  );
}

/** Выбор темы: системная / светлая / тёмная — с миниатюрами. */
export function ThemePicker({ value, onChange }: { value: ThemePref; onChange: (v: ThemePref) => void }) {
  const { t } = useT();
  const items: { v: ThemePref; label: string; icon: string }[] = [
    { v: 'auto', label: t('settings.theme_auto'), icon: 'phone' },
    { v: 'light', label: t('settings.theme_light'), icon: 'sun' },
    { v: 'dark', label: t('settings.theme_dark'), icon: 'moon' },
  ];
  return (
    <div className="theme-picker" role="radiogroup" aria-label={t('settings.theme')}>
      {items.map((it) => (
        <button key={it.v} role="radio" aria-checked={value === it.v} className={`theme-card ${value === it.v ? 'on' : ''}`} onClick={() => onChange(it.v)}>
          <span className={`tc-prev ${it.v}`}>
            <i className="tc-bar" />
            <i className="tc-blob" />
            <i className="tc-pin" />
          </span>
          <span className="tc-label">
            <Icon name={it.icon} size={14} /> {it.label}
          </span>
        </button>
      ))}
    </div>
  );
}

const NICK_ERRORS: Record<Exclude<NickCheck, 'ok'>, string> = {
  empty: 'profile.nick_empty',
  short: 'profile.nick_short',
  long: 'profile.nick_long',
  chars: 'profile.nick_chars',
};

/** Форма профиля: ник (обязателен), аватар, страна, вес. Используется в знакомстве и в настройках. */
export function ProfileForm({ value, onChange, showErrors }: { value: ProfileValue; onChange: (p: Partial<ProfileValue>) => void; showErrors?: boolean }) {
  const { t, lang } = useT();
  const [picking, setPicking] = useState(false);
  const check = checkNickname(value.nickname);
  const country = value.homeCountry ? countryByCode(value.homeCountry) : undefined;
  const err = check !== 'ok' && (showErrors || check !== 'empty') ? t(NICK_ERRORS[check]) : null;
  return (
    <div className="profile-form">
      <div className="pf-top">
        <Avatar icon={value.avatarIcon} color={value.avatarColor} size={64} />
        <label className="field grow">
          <span>
            {t('profile.nick')} <b className="req" aria-hidden>*</b>
          </span>
          <input
            className={`input ${err ? 'bad' : ''}`}
            value={value.nickname}
            maxLength={NICK_MAX + 8}
            autoComplete="nickname"
            autoCapitalize="words"
            spellCheck={false}
            placeholder={t('profile.nick_ph')}
            aria-invalid={!!err}
            aria-required
            onChange={(e) => {
              const nickname = e.target.value;
              // пока аватар не выбирали руками — подбираем по нику
              onChange({ nickname, ...(checkNickname(nickname) === 'ok' && value.avatarIcon === 'compass' && value.avatarColor === '#3DDC97' ? (({ icon, color }) => ({ avatarIcon: icon, avatarColor: color }))(suggestAvatar(nickname)) : {}) });
            }}
          />
        </label>
      </div>
      {err ? <small className="pf-err">{err}</small> : <small className="muted">{t('profile.nick_hint')}</small>}

      <div className="pf-block">
        <span className="pf-label">{t('profile.avatar')}</span>
        <div className="pf-icons">
          {AVATAR_ICONS.map((ic) => (
            <button key={ic} className={`pf-ic ${value.avatarIcon === ic ? 'on' : ''}`} style={{ ['--c' as string]: value.avatarColor }} onClick={() => onChange({ avatarIcon: ic })} aria-label={ic} aria-pressed={value.avatarIcon === ic}>
              <Icon name={ic} size={19} />
            </button>
          ))}
        </div>
        <div className="pf-colors">
          {AVATAR_COLORS.map((c) => (
            <button key={c} className={`pf-color ${value.avatarColor === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange({ avatarColor: c })} aria-label={c} aria-pressed={value.avatarColor === c} />
          ))}
        </div>
      </div>

      <div className="pf-block">
        <span className="pf-label">{t('profile.country')}</span>
        {picking ? (
          <CountryPicker
            selected={value.homeCountry}
            maxHeight={220}
            onPick={(c) => {
              onChange({ homeCountry: c.code });
              setPicking(false);
            }}
          />
        ) : (
          <div className="pf-country">
            <button className="pick-btn" onClick={() => setPicking(true)}>
              {country ? (
                <>
                  <span className="flag">{country.flag}</span> {countryName(country, lang)}
                </>
              ) : (
                <span className="muted">{t('profile.country_none')}</span>
              )}
              <Icon name="chevron-right" size={16} />
            </button>
            {country && (
              <button className="icon-btn" onClick={() => onChange({ homeCountry: '' })} aria-label={t('common.clear')}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="pf-block">
        <div className="slider-row">
          <span className="pf-label">{t('profile.weight')}</span>
          <b>{value.weightKg} {t('unit.kg')}</b>
        </div>
        <input type="range" min={35} max={160} step={1} value={value.weightKg} aria-label={t('profile.weight')} onChange={(e) => onChange({ weightKg: Number(e.target.value) })} />
        <small className="muted">{t('profile.weight_hint')}</small>
      </div>
    </div>
  );
}

/** Профиль из настроек (изменения применяются сразу; невалидный ник не сохраняется). */
export function usePrefsProfile(): [ProfileValue, (p: Partial<ProfileValue>) => void] {
  const p = usePrefs();
  const value: ProfileValue = { nickname: p.nickname, avatarIcon: p.avatarIcon, avatarColor: p.avatarColor, homeCountry: p.homeCountry, weightKg: p.weightKg };
  return [value, (patch) => p.set(patch)];
}
