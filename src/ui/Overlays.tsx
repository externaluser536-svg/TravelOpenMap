import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { ProgressRing, Segmented } from './common';
import { ProfileForm, ThemePicker, type ProfileValue } from './ProfileForm';
import { checkNickname, normalizeNick } from '../core/profile';
import { startLocation } from '../services/location';
import { startCompass } from '../services/compass';

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <button key={x.id} className={`toast glass ${x.kind}`} onClick={() => dismiss(x.id)}>
          <span className="toast-ic">
            <Icon name={x.icon ?? (x.kind === 'error' ? 'triangle-alert' : 'sparkles')} size={20} />
          </span>
          <span className="toast-main">
            <b>{x.title}</b>
            {x.text && <small>{x.text}</small>}
          </span>
          {x.xp !== undefined && <span className="xp-tag">+{x.xp} XP</span>}
        </button>
      ))}
    </div>
  );
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => i);

export function LevelUp() {
  const { t } = useT();
  const lu = useApp((s) => s.levelUp);
  const patch = useApp((s) => s.patch);
  if (!lu) return null;
  return (
    <div className="modal-layer" onClick={() => patch({ levelUp: null })}>
      <div className="confetti" aria-hidden>
        {CONFETTI.map((i) => (
          <i key={i} style={{ ['--i' as string]: i, ['--x' as string]: `${(i * 37) % 100}%`, ['--d' as string]: `${(i % 7) * 0.12}s`, ['--h' as string]: `${(i * 47) % 360}` }} />
        ))}
      </div>
      <div className="modal levelup" onClick={(e) => e.stopPropagation()}>
        <ProgressRing value={1} size={120} stroke={8} color="url(#lvgrad2)">
          <div className="lv-num">
            <small>{t('level.short')}</small>
            <b>{lu.level}</b>
          </div>
        </ProgressRing>
        <svg width="0" height="0" style={{ position: 'absolute' }}>
          <defs>
            <linearGradient id="lvgrad2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#3DDC97" />
              <stop offset="1" stopColor="#6C8CFF" />
            </linearGradient>
          </defs>
        </svg>
        <h2>{t('level.up')}</h2>
        <p>{t(lu.titleKey)}</p>
        <button className="btn primary block" onClick={() => patch({ levelUp: null })}>
          {t('common.great')}
        </button>
      </div>
    </div>
  );
}

const SLIDES = [
  { icon: 'cloud', tone: '#6C8CFF', title: 'onb.1.title', text: 'onb.1.text' },
  { icon: 'pin', tone: '#FFB547', title: 'onb.2.title', text: 'onb.2.text' },
  { icon: 'trophy', tone: '#3DDC97', title: 'onb.3.title', text: 'onb.3.text' },
  { icon: 'wifi-off', tone: '#F472B6', title: 'onb.4.title', text: 'onb.4.text' },
];

type Step = { kind: 'slide'; icon: string; tone: string; title: string; text: string } | { kind: 'look' } | { kind: 'me' };
const STEPS: Step[] = [...SLIDES.map((x) => ({ kind: 'slide' as const, ...x })), { kind: 'look' }, { kind: 'me' }];
const LOOK = STEPS.findIndex((x) => x.kind === 'look');
const ME = STEPS.findIndex((x) => x.kind === 'me');

export function Onboarding() {
  const { t } = useT();
  const done = usePrefs((s) => s.onboarded);
  const savedNick = usePrefs((s) => s.nickname);
  // уже знакомые пользователи предыдущих версий: спрашиваем только ник
  const nickOnly = done && checkNickname(savedNick) !== 'ok';
  const prefs = usePrefs();
  const [i, setI] = useState(nickOnly ? ME : 0);
  const [draft, setDraft] = useState<ProfileValue>({
    nickname: savedNick,
    avatarIcon: prefs.avatarIcon,
    avatarColor: prefs.avatarColor,
    homeCountry: prefs.homeCountry,
    weightKg: prefs.weightKg,
  });
  const [tried, setTried] = useState(false);
  useEffect(() => {
    setI(nickOnly ? ME : 0);
  }, [done, nickOnly]);
  if (done && !nickOnly) return null;

  const step = STEPS[i];
  const nickOk = checkNickname(draft.nickname) === 'ok';
  const finish = () => {
    if (!nickOk) {
      setTried(true);
      return;
    }
    const wasOnboarded = usePrefs.getState().onboarded;
    usePrefs.getState().set({ ...draft, nickname: normalizeNick(draft.nickname), onboarded: true });
    if (!wasOnboarded) {
      void startLocation();
      void startCompass(true);
    }
  };
  return (
    <div className="onboarding" role="dialog" aria-modal="true">
      <div className="onb-top">
        {i > 0 && !nickOnly ? (
          <button className="skip" onClick={() => setI(i - 1)}>
            {t('onb.back')}
          </button>
        ) : (
          <span />
        )}
        {step.kind === 'slide' ? (
          <button className="skip" onClick={() => setI(LOOK)}>
            {t('onb.skip')}
          </button>
        ) : (
          <span />
        )}
      </div>

      {step.kind === 'slide' && (
        <>
          <div className="onb-art" style={{ ['--c' as string]: step.tone }} key={i}>
            <span className="onb-ring r1" />
            <span className="onb-ring r2" />
            <span className="onb-ic">
              <Icon name={step.icon} size={54} strokeWidth={1.8} />
            </span>
          </div>
          <div className="onb-text" key={`t${i}`}>
            <h1>{t(step.title)}</h1>
            <p>{t(step.text)}</p>
          </div>
        </>
      )}

      {step.kind === 'look' && (
        <div className="onb-form" key="look">
          <div className="onb-text left">
            <h1>{t('onb.look.title')}</h1>
            <p>{t('onb.look.text')}</p>
          </div>
          <div className="form">
            <div className="set-col">
              <span><Icon name="languages" size={18} /> {t('settings.language')}</span>
              <Segmented value={prefs.lang} onChange={(v) => prefs.set({ lang: v })} options={[{ value: 'ru', label: 'Русский' }, { value: 'en', label: 'English' }]} />
            </div>
            <div className="set-col">
              <span><Icon name="palette" size={18} /> {t('settings.theme')}</span>
              <ThemePicker value={prefs.theme} onChange={(v) => prefs.set({ theme: v })} />
            </div>
            <div className="set-col">
              <span><Icon name="ruler" size={18} /> {t('settings.units')}</span>
              <Segmented value={prefs.units} onChange={(v) => prefs.set({ units: v })} options={[{ value: 'metric', label: t('settings.metric') }, { value: 'imperial', label: t('settings.imperial') }]} />
            </div>
          </div>
        </div>
      )}

      {step.kind === 'me' && (
        <div className="onb-form" key="me">
          <div className="onb-text left">
            <h1>{t(nickOnly ? 'onb.nick_only.title' : 'onb.me.title')}</h1>
            <p>{t(nickOnly ? 'onb.nick_only.text' : 'onb.me.text')}</p>
          </div>
          <ProfileForm value={draft} onChange={(p) => setDraft({ ...draft, ...p })} showErrors={tried} />
        </div>
      )}

      <div className="onb-foot">
        {!nickOnly && (
          <div className="dots">
            {STEPS.map((_, k) => (
              <i key={k} className={k === i ? 'on' : ''} />
            ))}
          </div>
        )}
        <button
          className="btn primary block"
          aria-disabled={step.kind === 'me' && !nickOk}
          onClick={() => (step.kind === 'me' ? finish() : setI(i + 1))}
        >
          {step.kind === 'me' ? t(nickOnly ? 'common.save' : 'onb.start') : t('onb.next')} <Icon name="chevron-right" size={18} />
        </button>
        {step.kind === 'me' && !nickOk && <small className="muted center">{t('onb.need_nick')}</small>}
        {step.kind === 'me' && nickOk && !nickOnly && <small className="muted center">{t('onb.perms')}</small>}
      </div>
    </div>
  );
}
