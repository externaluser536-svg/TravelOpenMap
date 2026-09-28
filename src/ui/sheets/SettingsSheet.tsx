import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Segmented, Sheet, Switch } from '../common';
import { formatDistance } from '../../core/geo';

export function SettingsSheet() {
  const { t, lang } = useT();
  const p = usePrefs();
  const patch = useApp((s) => s.patch);
  const demo = (window as unknown as { __tom?: { seedDemo?: () => Promise<void> } }).__tom;
  return (
    <Sheet tall title={t('settings.title')} onClose={() => patch({ sheet: null })}>
      <div className="form settings">
        <h4 className="sect-sm">{t('settings.appearance')}</h4>
        <div className="set-row">
          <span>
            <Icon name="palette" size={18} /> {t('settings.theme')}
          </span>
          <Segmented
            value={p.theme}
            onChange={(v) => p.set({ theme: v })}
            options={[
              { value: 'auto', label: t('settings.theme_auto') },
              { value: 'light', label: <Icon name="sun" size={15} /> },
              { value: 'dark', label: <Icon name="moon" size={15} /> },
            ]}
          />
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
