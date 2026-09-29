import { useState } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Bar, ProgressRing } from '../common';
import { GROUP_ORDER, type ChallengeState, type DailyQuest } from '../../core/challenges';
import { formatArea, formatDistance } from '../../core/geo';
import { titleForLevel } from '../../core/levels';

function fmtValue(unit: string, v: number, units: 'metric' | 'imperial', lang: 'ru' | 'en'): string {
  if (unit === 'km2') return formatArea(v, units, lang);
  if (unit === 'km') return formatDistance(v, units, lang);
  return String(Math.floor(v));
}

function Quest({ c }: { c: ChallengeState }) {
  const { t, lang } = useT();
  const units = usePrefs((s) => s.units);
  const { def } = c;
  return (
    <div className={`quest ${c.done ? 'done' : ''}`}>
      <span className="q-ic">
        <Icon name={c.done ? 'check' : def.icon} size={20} strokeWidth={c.done ? 3 : 2} />
      </span>
      <div className="q-main">
        <div className="q-top">
          <b>{t(`ch.${def.id}`)}</b>
          <span className="xp-tag">+{def.xp} XP</span>
        </div>
        <small>{t(`chd.${def.id}`)}</small>
        {!c.done && (
          <>
            <Bar value={c.progress} />
            <small className="q-prog">
              {fmtValue(def.unit === 'days' ? 'count' : def.unit, c.value, units, lang)} / {fmtValue(def.unit === 'days' ? 'count' : def.unit, def.target, units, lang)}
              {def.unit === 'days' ? ` ${t('unit.days')}` : ''}
            </small>
          </>
        )}
      </div>
    </div>
  );
}

function Daily({ q }: { q: DailyQuest }) {
  const { t, lang } = useT();
  const units = usePrefs((s) => s.units);
  const label = t(`daily.${q.kind}`, {
    n: q.unit === 'km' ? formatDistance(q.target, units, lang) : q.unit === 'km2' ? formatArea(q.target, units, lang) : q.target,
  });
  return (
    <div className={`daily ${q.done ? 'done' : ''}`}>
      <ProgressRing value={q.progress} size={44} stroke={4} color={q.done ? 'var(--accent)' : 'var(--warn)'}>
        <Icon name={q.done ? 'check' : q.icon} size={18} strokeWidth={q.done ? 3 : 2} />
      </ProgressRing>
      <div className="d-main">
        <b>{label}</b>
        <small>+{q.xp} XP</small>
      </div>
    </div>
  );
}

export function QuestsView() {
  const { t, tn } = useT();
  const level = useApp((s) => s.level);
  const stats = useApp((s) => s.stats);
  const challenges = useApp((s) => s.challenges);
  const quests = useApp((s) => s.quests);
  const [open, setOpen] = useState<Record<string, boolean>>({ explore: true });
  const doneCount = challenges.filter((c) => c.done).length;
  const nextTitle = (() => {
    for (let l = level.level + 1; l <= 60; l++) if (titleForLevel(l) !== level.titleKey) return { level: l, key: titleForLevel(l) };
    return null;
  })();
  // ближайшие к выполнению
  const closest = challenges.filter((c) => !c.done).sort((a, b) => b.progress - a.progress).slice(0, 3);

  return (
    <>
        <section className="level-card">
          <div className="lv-glow" />
          <ProgressRing value={level.progress} size={104} stroke={7} color="url(#lvgrad)">
            <div className="lv-num">
              <small>{t('level.short')}</small>
              <b>{level.level}</b>
            </div>
          </ProgressRing>
          <svg width="0" height="0" style={{ position: 'absolute' }}>
            <defs>
              <linearGradient id="lvgrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#3DDC97" />
                <stop offset="1" stopColor="#6C8CFF" />
              </linearGradient>
            </defs>
          </svg>
          <div className="lv-info">
            <h1>{t(level.titleKey)}</h1>
            <p>{level.maxed ? t('level.max') : t('level.to_next', { xp: level.span - level.into, n: level.level + 1 })}</p>
            <Bar value={level.progress} color="linear-gradient(90deg,#3DDC97,#6C8CFF)" />
            <small>
              {level.xp} XP{nextTitle ? ` · ${t('level.next_title', { n: nextTitle.level, title: t(nextTitle.key) })}` : ''}
            </small>
          </div>
        </section>

        <section className="streak-row">
          <div className="streak-card">
            <Icon name="flame" size={22} />
            <div>
              <b>{stats.streak}</b>
              <small>{tn('unit.day', stats.streak)} {t('quests.streak')}</small>
            </div>
          </div>
          <div className="streak-card alt">
            <Icon name="trophy" size={22} />
            <div>
              <b>
                {doneCount}/{challenges.length}
              </b>
              <small>{t('quests.done')}</small>
            </div>
          </div>
        </section>

        <h3 className="sect">{t('quests.daily')}</h3>
        <div className="daily-list">
          {quests.map((q) => (
            <Daily key={q.id} q={q} />
          ))}
        </div>

        {closest.length > 0 && (
          <>
            <h3 className="sect">{t('quests.closest')}</h3>
            <div className="quest-list">
              {closest.map((c) => (
                <Quest key={c.def.id} c={c} />
              ))}
            </div>
          </>
        )}

        <h3 className="sect">{t('quests.all')}</h3>
        {GROUP_ORDER.map((g) => {
          const items = challenges.filter((c) => c.def.group === g);
          const done = items.filter((c) => c.done).length;
          return (
            <div key={g} className="group">
              <button className="group-head" onClick={() => setOpen({ ...open, [g]: !open[g] })}>
                <span>{t(`group.${g}`)}</span>
                <small>
                  {done}/{items.length}
                </small>
                <Icon name="chevron-right" size={18} style={{ transform: open[g] ? 'rotate(90deg)' : 'none', transition: 'transform .2s' }} />
              </button>
              {open[g] && (
                <div className="quest-list">
                  {items.map((c) => (
                    <Quest key={c.def.id} c={c} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        <div style={{ height: 24 }} />
    </>
  );
}
