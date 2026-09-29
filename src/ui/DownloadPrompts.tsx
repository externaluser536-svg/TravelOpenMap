import { useApp } from '../state/store';
import { useT } from '../i18n';
import { Icon } from './icons';
import { acceptOnline, cancelDownload, declineOnline, dismissAreaPrompt, requestDownload } from '../state/downloads';
import { DETAIL_PRESETS } from '../data/countries';
import { fmtBytes } from './format';

/**
 * Вопросы про карты:
 *  • после знакомства — включить онлайн-карту (окно с пояснением, что и куда передаётся);
 *  • при приближении к области, которой нет среди сохранённых, — карточка «сохранить для офлайна»;
 *  • ход сохранения области.
 */
export function DownloadPrompts() {
  const { t } = useT();
  const prompt = useApp((s) => s.downloadPrompt);
  const dl = useApp((s) => s.download);
  const sheet = useApp((s) => s.sheet);
  const screen = useApp((s) => s.screen);
  const patch = useApp((s) => s.patch);

  if (prompt && (prompt.kind === 'online' || prompt.kind === 'consent')) {
    const first = prompt.kind === 'online';
    const j = prompt.kind === 'consent' ? prompt.job : null;
    return (
      <div className="modal-layer" role="dialog" aria-modal="true" aria-label={t('prompt.online.title')}>
        <div className="modal download-modal" onClick={(e) => e.stopPropagation()}>
          <span className="dm-ic">
            <Icon name="globe" size={30} strokeWidth={1.9} />
          </span>
          <h2>{t('prompt.online.title')}</h2>
          <p>{first ? t('prompt.online.text') : t('prompt.consent.text', { name: j!.name, size: fmtBytes(j!.estimate) })}</p>
          <small className="muted">{t('prompt.online.privacy')}</small>
          <button className="btn primary block" onClick={() => acceptOnline(j ?? undefined)}>
            <Icon name="download" size={18} /> {t(first ? 'prompt.online.yes' : 'prompt.consent.yes')}
          </button>
          <button className="btn ghost block" onClick={() => (first ? declineOnline() : patch({ downloadPrompt: null }))}>
            {t(first ? 'prompt.online.no' : 'common.cancel')}
          </button>
          {first && <small className="muted">{t('prompt.online.later')}</small>}
        </div>
      </div>
    );
  }

  // карточки — только на экране карты; окна с разрешением (выше) видны везде, в том числе поверх настроек
  if (screen !== 'map') return null;

  // ход сохранения (если открыт лист страны, прогресс показывается в нём)
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
              {t('prompt.area.text', { detail: detail ? t(`countries.d.${detail}`) : `z≤${j.maxZoom}`, size: fmtBytes(j.estimate) })}
            </small>
          </div>
          <button className="icon-btn" aria-label={t('prompt.area.never')} title={t('prompt.area.never')} onClick={() => dismissAreaPrompt(true)}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="ap-actions">
          <button className="btn ghost sm" onClick={() => dismissAreaPrompt(false)}>{t('prompt.area.later')}</button>
          <button className="btn primary sm" onClick={() => requestDownload(j)}>
            <Icon name="download" size={15} /> {t('saved.save')}
          </button>
        </div>
      </div>
    );
  }
  return null;
}
