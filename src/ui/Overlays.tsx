import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { ProgressRing } from './common';
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

export function Onboarding() {
  const { t } = useT();
  const done = usePrefs((s) => s.onboarded);
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
  }, [done]);
  if (done) return null;
  const last = i === SLIDES.length - 1;
  const finish = () => {
    usePrefs.getState().set({ onboarded: true });
    void startLocation();
    void startCompass(true);
  };
  const s = SLIDES[i];
  return (
    <div className="onboarding">
      <button className="skip" onClick={finish}>
        {t('onb.skip')}
      </button>
      <div className="onb-art" style={{ ['--c' as string]: s.tone }} key={i}>
        <span className="onb-ring r1" />
        <span className="onb-ring r2" />
        <span className="onb-ic">
          <Icon name={s.icon} size={54} strokeWidth={1.8} />
        </span>
      </div>
      <div className="onb-text" key={`t${i}`}>
        <h1>{t(s.title)}</h1>
        <p>{t(s.text)}</p>
      </div>
      <div className="onb-foot">
        <div className="dots">
          {SLIDES.map((_, k) => (
            <i key={k} className={k === i ? 'on' : ''} />
          ))}
        </div>
        <button className="btn primary block" onClick={() => (last ? finish() : setI(i + 1))}>
          {last ? t('onb.start') : t('onb.next')} <Icon name="chevron-right" size={18} />
        </button>
        {last && <small className="muted center">{t('onb.perms')}</small>}
      </div>
    </div>
  );
}
