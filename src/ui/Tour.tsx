import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useT } from '../i18n';
import { Icon } from './icons';
import { TOUR_STEPS, acceptTour, declineTour, endTour, goTour } from '../state/tour';

/** Окно после знакомства: пройти короткое обучение или отказаться. */
export function TourOffer() {
  const { t } = useT();
  const offer = useApp((s) => s.tourOffer);
  if (!offer) return null;
  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={t('tour.offer.title')}>
      <div className="modal download-modal tour-offer" onClick={(e) => e.stopPropagation()}>
        <span className="dm-ic">
          <Icon name="lightbulb" size={30} strokeWidth={1.9} />
        </span>
        <h2>{t('tour.offer.title')}</h2>
        <p>{t('tour.offer.text')}</p>
        <button className="btn primary block" onClick={acceptTour}>
          <Icon name="play" size={18} /> {t('tour.offer.yes')}
        </button>
        <button className="btn ghost block" onClick={declineTour}>
          {t('tour.offer.no')}
        </button>
        <small className="muted">{t('tour.offer.later')}</small>
      </div>
    </div>
  );
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PAD = 8;

function measure(target: string | undefined): Rect | null {
  if (!target) return null;
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
}

/** Пошаговое обучение: затемнение с «окном» вокруг элемента и подсказка рядом. */
export function TourOverlay() {
  const { t } = useT();
  const tour = useApp((s) => s.tour);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(180);
  const step = tour ? TOUR_STEPS[tour.step] : null;

  useEffect(() => {
    if (!step) return;
    const update = () => {
      setRect(measure(step.target));
      setVp({ w: window.innerWidth, h: window.innerHeight });
    };
    update();
    // элементы могут появиться с анимацией — следим за положением, пока подсказка на экране
    const id = window.setInterval(update, 250);
    window.addEventListener('resize', update);
    return () => {
      clearInterval(id);
      window.removeEventListener('resize', update);
    };
  }, [step]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [tour?.step]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight') goTour(tour.step + 1);
      if (e.key === 'ArrowLeft') goTour(tour.step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tour]);

  if (!tour || !step) return null;
  const last = tour.step === TOUR_STEPS.length - 1;
  const total = TOUR_STEPS.length;

  // подсказка над элементом, если он в нижней половине экрана, иначе под ним; без цели — по центру
  let top: number;
  if (!rect) top = Math.max(24, (vp.h - cardH) / 2);
  else if (rect.y + rect.h / 2 > vp.h / 2) top = Math.max(16, rect.y - cardH - 16);
  else top = Math.min(vp.h - cardH - 16, rect.y + rect.h + 16);

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={t('tour.title')}>
      <svg className="tour-mask" width={vp.w} height={vp.h} viewBox={`0 0 ${vp.w} ${vp.h}`} aria-hidden>
        <defs>
          <mask id="tour-hole">
            <rect width={vp.w} height={vp.h} fill="#fff" />
            {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx={Math.min(22, rect.h / 2)} fill="#000" />}
          </mask>
        </defs>
        <rect width={vp.w} height={vp.h} fill="rgba(4,8,20,0.74)" mask="url(#tour-hole)" />
      </svg>
      {rect && <div className="tour-ring" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderRadius: Math.min(22, rect.h / 2) }} />}
      <div ref={card} className="tour-card glass" style={{ top }}>
        <div className="tour-head">
          <span className="tour-count">{tour.step + 1} / {total}</span>
          <button className="tour-skip" onClick={endTour}>
            {t('tour.skip')}
          </button>
        </div>
        <h3>{t(`tour.${step.id}.t`)}</h3>
        <p>{t(`tour.${step.id}.d`)}</p>
        <div className="tour-dots" aria-hidden>
          {TOUR_STEPS.map((_, i) => (
            <i key={i} className={i === tour.step ? 'on' : i < tour.step ? 'done' : ''} />
          ))}
        </div>
        <div className="row-btns">
          <button className="btn ghost" disabled={tour.step === 0} onClick={() => goTour(tour.step - 1)}>
            <Icon name="chevron-left" size={16} /> {t('tour.back')}
          </button>
          <button className="btn primary grow" onClick={() => goTour(tour.step + 1)}>
            {last ? t('tour.finish') : t('tour.next')} {!last && <Icon name="chevron-right" size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}
