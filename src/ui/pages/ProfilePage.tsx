import { useApp, type ProfileTab } from '../../state/store';
import { usePrefs } from '../../state/prefs';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { ProgressRing, Row, Segmented } from '../common';
import { StatsView } from './StatsView';
import { QuestsView } from './QuestsPage';
import { TripsView } from './TripsView';

export function ProfilePage() {
  const { t } = useT();
  const level = useApp((s) => s.level);
  const mapInfo = useApp((s) => s.mapInfo);
  const tab = useApp((s) => s.profileTab);
  const patch = useApp((s) => s.patch);
  const zones = usePrefs((s) => s.zones);
  const open = (type: 'settings' | 'maps' | 'zones' | 'data' | 'privacy') => patch({ sheet: { type } });

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

        <div className="sticky-seg">
          <Segmented
            value={tab}
            onChange={(v) => patch({ profileTab: v as ProfileTab })}
            options={[
              { value: 'stats' as ProfileTab, label: <><Icon name="chart" size={15} />&nbsp;{t('profile.tab.stats')}</> },
              { value: 'quests' as ProfileTab, label: <><Icon name="trophy" size={15} />&nbsp;{t('profile.tab.quests')}</> },
              { value: 'trips' as ProfileTab, label: <><Icon name="plane" size={15} />&nbsp;{t('profile.tab.trips')}</> },
            ]}
          />
        </div>

        {tab === 'stats' && (
          <>
            <StatsView />
            <h3 className="sect">{t('profile.manage')}</h3>
            <div className="card list">
              <Row icon="settings" title={t('settings.title')} sub={t('settings.sub')} onClick={() => open('settings')} />
              <Row icon="database" title={t('maps.title')} sub={mapInfo ? mapInfo.name : t('maps.none')} onClick={() => open('maps')} />
              <Row icon="shield" title={t('zones.title')} sub={zones.length ? `${zones.length}` : t('zones.sub_empty')} onClick={() => open('zones')} />
              <Row icon="hard-drive" title={t('data.title')} sub={t('data.sub')} onClick={() => open('data')} />
              <Row icon="wifi-off" title={t('privacy.title')} sub={t('privacy.sub')} onClick={() => open('privacy')} />
            </div>
            <p
              className="version"
              onClick={() => {
                const w = window as unknown as { __vt?: number };
                w.__vt = (w.__vt ?? 0) + 1;
                if (w.__vt >= 7) {
                  usePrefs.getState().set({ developer: !usePrefs.getState().developer });
                  w.__vt = 0;
                }
              }}
            >
              TravelOpenMap 0.2.0 · OpenStreetMap © {t('common.contributors')}
            </p>
          </>
        )}
        {tab === 'quests' && <QuestsView />}
        {tab === 'trips' && <TripsView />}
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}
