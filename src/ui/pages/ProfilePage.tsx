import { useApp } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { ProgressRing, Row } from '../common';
import { formatArea, formatDistance } from '../../core/geo';

function Stat({ icon, value, label, tone }: { icon: string; value: string; label: string; tone: string }) {
  return (
    <div className="stat" style={{ ['--c' as string]: tone }}>
      <span className="stat-ic">
        <Icon name={icon} size={18} />
      </span>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function ActivityChart() {
  const { t, lang } = useT();
  const days = useApp((s) => s.lastDays);
  const units = usePrefs((s) => s.units);
  const max = Math.max(1000, ...days.map((d) => d.distanceM));
  const W = 320;
  const H = 110;
  const bw = W / days.length;
  return (
    <div className="card chart-card">
      <div className="chart-head">
        <b>{t('profile.activity')}</b>
        <small className="muted">{t('profile.last14')}</small>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} width="100%" role="img" aria-label={t('profile.activity')}>
        <defs>
          <linearGradient id="barg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3DDC97" />
            <stop offset="1" stopColor="#6C8CFF" />
          </linearGradient>
        </defs>
        {[0.5, 1].map((f) => (
          <line key={f} x1="0" x2={W} y1={H - H * f * 0.9} y2={H - H * f * 0.9} stroke="var(--border)" strokeDasharray="3 5" />
        ))}
        {days.map((d, i) => {
          const h = Math.max(d.distanceM > 0 ? 4 : 2, (d.distanceM / max) * H * 0.9);
          const x = i * bw + bw * 0.18;
          const isToday = i === days.length - 1;
          return (
            <g key={d.date}>
              <rect x={x} y={H - h} width={bw * 0.64} height={h} rx={4} fill={d.distanceM > 0 ? 'url(#barg)' : 'var(--ring-track)'} opacity={isToday ? 1 : 0.85}>
                <title>{`${d.date}: ${formatDistance(d.distanceM, units, lang)}`}</title>
              </rect>
              {(i % 2 === 1 || isToday) && (
                <text x={x + bw * 0.32} y={H + 14} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
                  {d.date.slice(8)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function ProfilePage() {
  const { t, lang, tn } = useT();
  const level = useApp((s) => s.level);
  const stats = useApp((s) => s.stats);
  const mapInfo = useApp((s) => s.mapInfo);
  const units = usePrefs((s) => s.units);
  const zones = usePrefs((s) => s.zones);
  const open = (type: 'settings' | 'maps' | 'zones' | 'data' | 'privacy') => useApp.getState().patch({ sheet: { type } });

  return (
    <div className="page">
      <div className="page-scroll pad-top">
        <section className="profile-head">
          <ProgressRing value={level.progress} size={72} stroke={5}>
            <Icon name="user" size={26} />
          </ProgressRing>
          <div>
            <h1>{t(level.titleKey)}</h1>
            <p className="muted">
              {t('level.short')} {level.level} · {level.xp} XP
            </p>
          </div>
          <button className="icon-btn big" onClick={() => open('settings')} aria-label={t('settings.title')}>
            <Icon name="settings" />
          </button>
        </section>

        <div className="stat-grid">
          <Stat icon="map" value={formatArea(stats.areaM2, units, lang)} label={t('stat.area')} tone="#3DDC97" />
          <Stat icon="footprints" value={formatDistance(stats.distanceM, units, lang)} label={t('stat.distance')} tone="#6C8CFF" />
          <Stat icon="pin" value={String(stats.notes)} label={tn('unit.note', stats.notes)} tone="#FFB547" />
          <Stat icon="camera" value={String(stats.photos + stats.videos)} label={t('stat.media')} tone="#F472B6" />
          <Stat icon="calendar" value={String(stats.activeDays)} label={t('stat.days')} tone="#2DD4BF" />
          <Stat icon="flame" value={String(stats.bestStreak)} label={t('stat.best_streak')} tone="#FF8A5C" />
        </div>

        <ActivityChart />

        <h3 className="sect">{t('profile.manage')}</h3>
        <div className="card list">
          <Row icon="settings" title={t('settings.title')} sub={t('settings.sub')} onClick={() => open('settings')} />
          <Row icon="database" title={t('maps.title')} sub={mapInfo ? mapInfo.name : t('maps.none')} onClick={() => open('maps')} />
          <Row icon="shield" title={t('zones.title')} sub={zones.length ? `${zones.length}` : t('zones.sub_empty')} onClick={() => open('zones')} />
          <Row icon="hard-drive" title={t('data.title')} sub={t('data.sub')} onClick={() => open('data')} />
          <Row icon="wifi-off" title={t('privacy.title')} sub={t('privacy.sub')} onClick={() => open('privacy')} />
        </div>
        <p className="version" onClick={() => {
          const n = ((window as unknown as { __vt?: number }).__vt ?? 0) + 1;
          (window as unknown as { __vt?: number }).__vt = n;
          if (n >= 7) {
            usePrefs.getState().set({ developer: !usePrefs.getState().developer });
            (window as unknown as { __vt?: number }).__vt = 0;
          }
        }}>
          TravelOpenMap 0.1.0 · OpenStreetMap © {t('common.contributors')}
        </p>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
