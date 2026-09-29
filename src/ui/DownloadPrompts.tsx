import { useApp } from '../state/store';
import { usePrefs } from '../state/prefs';
import { useT } from '../i18n';
import { Icon } from './icons';
import { acceptDownload, cancelDownload, declineWorld, dismissAreaPrompt, requestDownload } from '../state/downloads';
import { DETAIL_PRESETS } from '../data/countries';

const fmtSize = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.max(1, Math.round(b / 1e6))} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/**
 * Вопросы про загрузку карт:
 *  • после знакомства — обзорная карта мира (окно с разрешением на доступ в сеть);
 *  • при приближении к области без подробной карты — карточка с предложением;
 *  • ход загрузки, когда она идёт «в фоне».
 */
export function DownloadPrompts() {
  const { t } = useT();
  const prompt = useApp((s) => s.downloadPrompt);
  const dl = useApp((s) => s.download);
  const sheet = useApp((s) => s.sheet);
  const screen = useApp((s) => s.screen);
  const patch = useApp((s) => s.patch);
  const allow = usePrefs((s) => s.allowDownloads);

  if (prompt && (prompt.kind === 'world' || prompt.kind === 'consent')) {
    const world = prompt.kind === 'world';
    const j = prompt.job;
    return (
      <div className="modal-layer" role="dialog" aria-modal="true" aria-label={t(world ? 'prompt.world.title' : 'prompt.consent.title')}>
        <div className="modal download-modal" onClick={(e) => e.stopPropagation()}>
          <span className="dm-ic">
            <Icon name={world ? 'globe' : 'download'} size={30} strokeWidth={1.9} />
          </span>
          <h2>{t(world ? 'prompt.world.title' : 'prompt.consent.title')}</h2>
          <p>{world ? t('prompt.world.text', { size: fmtSize(j.estimate) }) : t('prompt.consent.text', { name: j.name, size: fmtSize(j.estimate) })}</p>
          <small className="muted">{t('prompt.privacy')}</small>
          <button className="btn primary block" onClick={() => acceptDownload(j)}>
            <Icon name="download" size={18} /> {t(world ? 'prompt.world.yes' : 'prompt.consent.yes')}
          </button>
          <button className="btn ghost block" onClick={() => (world ? declineWorld() : patch({ downloadPrompt: null }))}>
            {t(world ? 'prompt.world.no' : 'common.cancel')}
          </button>
          {world && <small className="muted">{t('prompt.world.later')}</small>}
        </div>
      </div>
    );
  }

  // карточки — только на экране карты; окна с разрешением (выше) видны везде, в том числе поверх настроек
  if (screen !== 'map') return null;

  // ход загрузки (если открыт лист страны, прогресс показывается в нём)
  if (dl && sheet?.type !== 'country') {
    if (dl.state === 'running') {
      const pct = dl.progress ? Math.round((dl.progress.done / Math.max(1, dl.progress.total)) * 100) : null;
      return (
        <div className="area-prompt glass" role="status">
          <div className="ap-row">
            <b>{t('dl.running', { name: dl.name })}</b>
            <small className="muted">{pct === null ? '…' : `${pct}%`}</small>
          </div>
          <div className="bar"><i style={{ width: `${pct ?? 3}%` }} /></div>
          <div className="ap-actions">
            <button className="btn ghost sm" onClick={cancelDownload}>{t('common.cancel')}</button>
          </div>
        </div>
      );
    }
    if (dl.state === 'error') {
      return (
        <div className="area-prompt glass err" role="alert">
          <div className="ap-row"><b>{dl.name}</b></div>
          <small>{dl.error}</small>
          <div className="ap-actions">
            <button className="btn ghost sm" onClick={() => patch({ download: null })}>{t('common.close')}</button>
            <button className="btn primary sm" onClick={() => patch({ sheet: { type: 'maps' }, download: null })}>{t('dl.settings')}</button>
          </div>
        </div>
      );
    }
  }

  if (prompt?.kind === 'area') {
    const j = prompt.job;
    const detail = DETAIL_PRESETS.find((d) => d.maxZoom === j.maxZoom)?.id;
    return (
      <div className="area-prompt glass" role="dialog" aria-label={t('prompt.area.title', { name: j.name })}>
        <div className="ap-row">
          <span className="dm-ic sm"><Icon name="download" size={18} /></span>
          <div className="ap-main">
            <b>{t('prompt.area.title', { name: `${j.flag ?? ''} ${j.name}`.trim() })}</b>
            <small className="muted">
              {t('prompt.area.text', { detail: detail ? t(`countries.d.${detail}`) : `z≤${j.maxZoom}`, size: fmtSize(j.estimate) })}
            </small>
          </div>
          <button className="icon-btn" aria-label={t('prompt.area.never')} title={t('prompt.area.never')} onClick={() => dismissAreaPrompt(true)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ap-actions">
          <button className="btn ghost sm" onClick={() => dismissAreaPrompt(false)}>{t('prompt.area.later')}</button>
          <button className="btn primary sm" onClick={() => requestDownload(j)}>
            <Icon name="download" size={15} /> {allow ? t('countries.download') : t('prompt.area.allow')}
          </button>
        </div>
      </div>
    );
  }
  return null;
}
