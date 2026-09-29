import { useEffect, useState } from 'react';
import { useApp } from '../../state/store';
import { useT } from '../../i18n';
import { Icon } from '../icons';
import { Row, Sheet } from '../common';
import { usePrefs } from '../../state/prefs';
import { gatewayLog } from '../../map/gateway-client';

/** Считает сетевые запросы, ушедшие за пределы приложения (по Resource Timing). */
export function externalRequests(): string[] {
  const own = location.origin;
  return performance
    .getEntriesByType('resource')
    .map((e) => e.name)
    .filter((u) => {
      if (u.startsWith('blob:') || u.startsWith('data:')) return false;
      try {
        return new URL(u).origin !== own;
      } catch {
        return false;
      }
    });
}

export function PrivacySheet() {
  const { t } = useT();
  const patch = useApp((s) => s.patch);
  const [ext, setExt] = useState<string[]>(externalRequests);
  const [total, setTotal] = useState(() => performance.getEntriesByType('resource').length);
  useEffect(() => {
    const id = setInterval(() => {
      setExt(externalRequests());
      setTotal(performance.getEntriesByType('resource').length);
    }, 1500);
    return () => clearInterval(id);
  }, []);
  const ok = ext.length === 0;
  const allow = usePrefs((s) => s.allowDownloads);
  return (
    <Sheet title={t('privacy.title')} onClose={() => patch({ sheet: null })}>
      <div className="form">
        <div className={`shield-hero ${ok ? 'ok' : 'bad'}`}>
          <span className="sh-ic">
            <Icon name={ok ? 'shield-check' : 'wifi'} size={34} />
          </span>
          <b className="sh-num">{ext.length}</b>
          <span>{t('privacy.external')}</span>
          <small>{t('privacy.checked', { n: total })}</small>
        </div>
        {!ok && (
          <div className="card">
            {ext.slice(0, 6).map((u) => (
              <small key={u} className="mono">
                {u}
              </small>
            ))}
          </div>
        )}
        <div className="card list">
          <Row
            icon={allow ? 'globe' : 'shield-check'}
            title={allow ? t('privacy.gateway_on') : t('privacy.gateway_off')}
            sub={allow ? `${t('privacy.gateway_on_sub')} ${gatewayLog.calls ? `· ${t('privacy.gateway_calls', { n: gatewayLog.calls, hosts: [...gatewayLog.hosts].join(', ') || '—' })}` : ''}` : t('privacy.gateway_off_sub')}
          />
          <Row icon="wifi-off" title={t('privacy.offline')} sub={t('privacy.offline_sub')} />
          <Row icon="database" title={t('privacy.local')} sub={t('privacy.local_sub')} />
          <Row icon="shield-check" title={t('privacy.csp')} sub={t('privacy.csp_sub')} />
          <Row icon="map" title={t('privacy.osm')} sub={t('privacy.osm_sub')} />
        </div>
        <small className="muted center">{t('privacy.perms')}</small>
      </div>
    </Sheet>
  );
}
