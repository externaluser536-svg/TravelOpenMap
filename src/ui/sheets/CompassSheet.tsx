import { useEffect } from 'react';
import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Sheet } from '../common';
import { bearing as calcBearing, cardinal, formatDistance, haversine, normDeg } from '../../core/geo';
import { startCompass } from '../../services/compass';
import { toggleOrient } from '../../state/actions';

const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);
const LABELS: { deg: number; l: string; main: boolean }[] = [
  { deg: 0, l: 'N', main: true },
  { deg: 45, l: 'NE', main: false },
  { deg: 90, l: 'E', main: true },
  { deg: 135, l: 'SE', main: false },
  { deg: 180, l: 'S', main: true },
  { deg: 225, l: 'SW', main: false },
  { deg: 270, l: 'W', main: true },
  { deg: 315, l: 'NW', main: false },
];
const RU: Record<string, string> = { N: 'С', NE: 'СВ', E: 'В', SE: 'ЮВ', S: 'Ю', SW: 'ЮЗ', W: 'З', NW: 'СЗ' };

export function CompassSheet() {
  const { t, lang } = useT();
  const sensor = useApp((s) => s.heading);
  const pos = useApp((s) => s.position);
  const target = useApp((s) => s.compassTarget);
  const notes = useApp((s) => s.notes);
  const orient = useApp((s) => s.orientMap);
  const needsPerm = useApp((s) => s.compassNeedsPermission);
  const units = usePrefs((s) => s.units);
  const patch = useApp((s) => s.patch);

  useEffect(() => {
    void startCompass(false);
  }, []);

  // запасной вариант: курс из GPS при движении
  const gpsCourse = pos?.heading != null && (pos.speed ?? 0) > 0.8 ? pos.heading : null;
  const heading = sensor ?? gpsCourse;
  const h = heading ?? 0;
  const brg = pos && target ? calcBearing(pos, target) : null;
  const dist = pos && target ? haversine(pos, target) : null;
  const nearest = pos ? [...notes].sort((a, b) => haversine(pos, a) - haversine(pos, b)).slice(0, 6) : notes.slice(0, 6);

  const R = 128;
  const at = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [160 + r * Math.cos(a), 160 + r * Math.sin(a)];
  };

  return (
    <Sheet tall title={t('compass.title')} onClose={() => patch({ sheet: null })}>
      <div className="compass-wrap">
        <div className="compass">
          <svg viewBox="0 0 320 320" width="100%">
            <defs>
              <radialGradient id="cg" cx="50%" cy="50%" r="50%">
                <stop offset="0.35" style={{ stopColor: 'var(--dial-in)' }} />
                <stop offset="1" style={{ stopColor: 'var(--dial-out)' }} />
              </radialGradient>
            </defs>
            <circle cx="160" cy="160" r="150" fill="url(#cg)" stroke="var(--border)" strokeWidth="2" />
            <g style={{ transform: `rotate(${-h}deg)`, transformOrigin: '160px 160px', transition: 'transform .15s linear' }}>
              {TICKS.map((d) => {
                const major = d % 45 === 0;
                const [x1, y1] = at(d, R + 16);
                const [x2, y2] = at(d, R + (major ? 4 : d % 15 === 0 ? 9 : 12));
                return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke={d === 0 ? '#FF5C5C' : 'var(--muted)'} strokeWidth={major ? 2.4 : 1.2} strokeLinecap="round" opacity={major ? 1 : 0.6} />;
              })}
              {LABELS.map(({ deg, l, main }) => {
                const [x, y] = at(deg, R - 14);
                return (
                  <text key={l} x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize={main ? 22 : 13} fontWeight={main ? 800 : 600} fill={l === 'N' ? '#FF5C5C' : main ? 'var(--text)' : 'var(--muted)'} transform={`rotate(${deg} ${x} ${y})`}>
                    {lang === 'ru' ? RU[l] : l}
                  </text>
                );
              })}
              {brg !== null && (
                <g transform={`rotate(${brg} 160 160)`}>
                  <circle cx="160" cy="22" r="11" fill="var(--accent)" stroke="var(--surface-solid)" strokeWidth="3" />
                  <path d="M160 16 l5 8 h-10z" fill="#0b1220" />
                </g>
              )}
            </g>
            {/* неподвижная метка направления взгляда */}
            <path d="M160 2 l9 15 h-18z" fill="var(--accent)" />
            {brg !== null ? (
              <g style={{ transform: `rotate(${brg - h}deg)`, transformOrigin: '160px 160px', transition: 'transform .15s linear' }}>
                <path d="M160 70 L182 172 H138 Z" fill="var(--accent)" />
                <path d="M160 250 L146 172 H174 Z" fill="var(--muted)" opacity=".35" />
              </g>
            ) : null}
            <circle cx="160" cy="160" r="62" fill="var(--surface-solid)" stroke="var(--border)" />
            <text x="160" y="154" textAnchor="middle" fontSize="38" fontWeight="800" fill="var(--text)">
              {heading === null ? '—' : `${Math.round(normDeg(h))}°`}
            </text>
            <text x="160" y="182" textAnchor="middle" fontSize="17" fontWeight="700" fill="var(--accent)">
              {heading === null ? '' : cardinal(h, lang)}
            </text>
          </svg>
        </div>

        {heading === null && (
          <div className="banner-inline">
            <Icon name="info" size={16} />
            <span>{needsPerm ? t('compass.need_perm') : t('compass.unavailable')}</span>
            {needsPerm && (
              <button className="btn primary sm" onClick={() => void startCompass(true)}>
                {t('compass.allow')}
              </button>
            )}
          </div>
        )}
        {sensor === null && gpsCourse !== null && <small className="muted center">{t('compass.gps_course')}</small>}

        {target ? (
          <div className="target-card card">
            <span className="tc-ic">
              <Icon name="target" size={20} />
            </span>
            <div className="tc-main">
              <b>{target.name}</b>
              <small>{dist === null ? t('note.no_gps') : `${formatDistance(dist, units, lang)} · ${brg !== null ? `${cardinal(brg, lang)} ${Math.round(brg)}°` : ''}`}</small>
            </div>
            <button className="icon-btn" onClick={() => patch({ compassTarget: null })} aria-label="clear">
              <Icon name="x" size={18} />
            </button>
          </div>
        ) : (
          <>
            <p className="muted center">{t('compass.pick_target')}</p>
            <div className="chips-scroll wrap">
              {nearest.length === 0 && <small className="muted">{t('notes.empty_title')}</small>}
              {nearest.map((n) => (
                <button key={n.id} className="chip-btn" onClick={() => patch({ compassTarget: { lng: n.lng, lat: n.lat, name: n.title } })}>
                  <Icon name="pin" size={14} /> {n.title}
                </button>
              ))}
            </div>
          </>
        )}

        <button className={`btn ${orient ? 'primary' : 'ghost'} block`} onClick={toggleOrient}>
          <Icon name="navigation" size={16} /> {orient ? t('compass.map_follows') : t('compass.orient_map')}
        </button>
      </div>
    </Sheet>
  );
}
