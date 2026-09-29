import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Segmented, Sheet, Switch } from '../common';
import { formatDistance } from '../../core/geo';
import { useState } from 'react';
import { ProfileForm, ThemePicker, type ProfileValue } from '../ProfileForm';
import { checkNickname, normalizeNick } from '../../core/profile';

/** Профиль в настройках: аватар, страна и вес применяются сразу, ник — когда он корректен. */
function SettingsProfile() {
  const p = usePrefs();
  const [nick, setNick] = useState(p.nickname);
  const value: ProfileValue = { nickname: nick, avatarIcon: p.avatarIcon, avatarColor: p.avatarColor, homeCountry: p.homeCountry, weightKg: p.weightKg };
  return (
    <ProfileForm
      value={value}
      showErrors
      onChange={(patch) => {
        const { nickname, ...rest } = patch;
        if (nickname !== undefined) {
          setNick(nickname);
          if (checkNickname(nickname) === 'ok') p.set({ nickname: normalizeNick(nickname) });
        }
        if (Object.keys(rest).length) p.set(rest);
      }}
    />
  );
}

export function SettingsSheet() {
  const { t, lang } = useT();
  const p = usePrefs();
  const patch = useApp((s) => s.patch);
  const demo = (window as unknown as { __tom?: { seedDemo?: () => Promise<void> } }).__tom;
  return (
    <Sheet tall title={t('settings.title')} onClose={() => patch({ sheet: null })}>
      <div className="form settings">
        <h4 className="sect-sm">{t('settings.profile')}</h4>
        <SettingsProfile />

        <h4 className="sect-sm">{t('settings.appearance')}</h4>
        <div className="set-col">
          <span>
            <Icon name="palette" size={18} /> {t('settings.theme')}
          </span>
          <ThemePicker value={p.theme} onChange={(v) => p.set({ theme: v })} />
          <small className="muted">{t('settings.theme_hint')}</small>
        </div>
        <div className="set-row">
          <span>
            <Icon name="languages" size={18} /> {t('settings.language')}
          </span>
          <Segmented value={p.lang} onChange={(v) => p.set({ lang: v })} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
        </div>
        <div className="set-row">
          <span>
            <Icon name="ruler" size={18} /> {t('settings.units')}
          </span>
          <Segmented value={p.units} onChange={(v) => p.set({ units: v })} options={[{ value: 'metric', label: t('settings.metric') }, { value: 'imperial', label: t('settings.imperial') }]} />
        </div>

        <h4 className="sect-sm">{t('settings.fog')}</h4>
        <div className="set-col">
          <span>
            <Icon name="cloud" size={18} /> {t('settings.radius')}
          </span>
          <Segmented
            value={p.revealRadius}
            onChange={(v) => p.set({ revealRadius: v })}
            options={[30, 60, 100, 150].map((v) => ({ value: v, label: formatDistance(v, p.units, lang) }))}
          />
          <small className="muted">{t('settings.radius_hint')}</small>
        </div>
        <div className="set-col">
          <div className="slider-row">
            <span>
              <Icon name="layers" size={18} /> {t('settings.density')}
            </span>
            <b>{Math.round(p.fogOpacity * 100)}%</b>
          </div>
          <input type="range" min={50} max={100} value={Math.round(p.fogOpacity * 100)} onChange={(e) => p.set({ fogOpacity: Number(e.target.value) / 100 })} />
        </div>
        <div className="set-col">
          <span>
            <Icon name="wind" size={18} /> {t('settings.wind')}
          </span>
          <Segmented
            value={p.fogWind}
            onChange={(v) => p.set({ fogWind: v })}
            options={[
              { value: 0, label: t('settings.wind_off') },
              { value: 1, label: t('settings.wind_calm') },
              { value: 2, label: t('settings.wind_strong') },
            ]}
          />
          <small className="muted">{t('settings.wind_hint')}</small>
        </div>
        <div className="set-col">
          <span>
            <Icon name="locate" size={18} /> {t('settings.accuracy')}
          </span>
          <Segmented value={p.minAccuracy} onChange={(v) => p.set({ minAccuracy: v })} options={[30, 60, 100, 200].map((v) => ({ value: v, label: `≤ ${formatDistance(v, p.units, lang)}` }))} />
          <small className="muted">{t('settings.accuracy_hint')}</small>
        </div>

        <h4 className="sect-sm">{t('settings.behavior')}</h4>
        <div className="set-row">
          <span>
            <Icon name="route" size={18} /> {t('settings.track')}
          </span>
          <Switch checked={p.recordTrack} onChange={(v) => p.set({ recordTrack: v })} label={t('settings.track')} />
        </div>
        <div className="set-row">
          <span>
            <Icon name="vibrate" size={18} /> {t('settings.haptics')}
          </span>
          <Switch checked={p.haptics} onChange={(v) => p.set({ haptics: v })} label={t('settings.haptics')} />
        </div>

        {p.developer && (
          <>
            <h4 className="sect-sm">{t('settings.developer')}</h4>
            {demo?.seedDemo ? (
              <button className="btn ghost block" onClick={() => void demo.seedDemo!()}>
                <Icon name="sparkles" size={16} /> {t('settings.seed_demo')}
              </button>
            ) : (
              <small className="muted">{t('settings.dev_only_demo')}</small>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
