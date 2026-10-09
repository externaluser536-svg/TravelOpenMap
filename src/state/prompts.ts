// Когда задавать вопросы про карты: онлайн-карта после знакомства и сохранение области при приближении.
// Ничего не скачивается без согласия пользователя — здесь только решаем, когда показать вопрос.

import { checkNickname } from '../core/profile';
import { PROMPT_MIN_ZOOM, planArea } from '../core/regions';
import { isSaved } from '../map/offline-areas';
import { usePrefs } from './prefs';
import { useApp } from './store';
import { areaJob, hereJob } from './downloads';
import { backgroundSupported } from '../services/background';

const AREA_DELAY_MS = 1200;
const ONLINE_DELAY_MS = 1500;
const HERE_DELAY_MS = 2000;

/** Области, о которых уже спрашивали в этой сессии («Позже» не значит «никогда»). */
const shownThisSession = new Set<string>();
let areaTimer = 0;
let onlineTimer = 0;
let tourTimer = 0;
let hereTimer = 0;
let bgTimer = 0;
let hereOffered = false;

const TOUR_DELAY_MS = 1200;

/** Первое знакомство закончилось — предлагаем короткое обучение (можно отказаться). */
function checkTour(): void {
  const prefs = usePrefs.getState();
  const app = useApp.getState();
  if (prefs.tutorialSeen || tourTimer || app.tourOffer || app.tour) return;
  const ready = () => {
    const a = useApp.getState();
    const p = usePrefs.getState();
    return (
      p.onboarded &&
      checkNickname(p.nickname) === 'ok' &&
      !p.tutorialSeen &&
      a.screen === 'map' &&
      !!a.mapInfo &&
      a.mode === 'normal' &&
      !a.sheet &&
      !a.levelUp &&
      !a.tour &&
      a.workoutLive === null &&
      !a.downloadPrompt
    );
  };
  if (!ready()) return;
  tourTimer = window.setTimeout(() => {
    tourTimer = 0;
    if (ready()) useApp.getState().patch({ tourOffer: true });
  }, TOUR_DELAY_MS);
}

/** Можно ли сейчас показывать вопросы: знакомство и обучение пройдены, открыта карта, ничего другого не мешает. */
function idle(): boolean {
  const app = useApp.getState();
  const prefs = usePrefs.getState();
  return (
    prefs.onboarded &&
    checkNickname(prefs.nickname) === 'ok' &&
    prefs.tutorialSeen &&
    app.screen === 'map' &&
    !!app.mapInfo &&
    app.mode === 'normal' &&
    !app.sheet &&
    !app.levelUp &&
    !app.tour &&
    !app.tourOffer &&
    !app.bgOffer &&
    app.workoutLive === null &&
    app.download?.state !== 'running'
  );
}

function checkOnline(): void {
  const prefs = usePrefs.getState();
  const app = useApp.getState();
  if (prefs.onlinePrompted) return;
  if (onlineTimer || !idle() || app.downloadPrompt) return;
  // подписка срабатывает на каждое обновление состояния — таймер ставим один раз, а условия перепроверяем по его истечении
  onlineTimer = window.setTimeout(() => {
    onlineTimer = 0;
    if (usePrefs.getState().onlinePrompted || !idle() || useApp.getState().downloadPrompt) return;
    useApp.getState().patch({ downloadPrompt: { kind: 'online' } });
  }, ONLINE_DELAY_MS);
}

/** Когда GPS заработал — предлагаем писать маршрут и при закрытом приложении (Android). Один раз. */
function checkBackground(): void {
  const prefs = usePrefs.getState();
  const app = useApp.getState();
  if (bgTimer || prefs.backgroundPrompted || !prefs.onlinePrompted || !backgroundSupported()) return;
  if (!app.position || app.bgOffer || app.downloadPrompt || !idle()) return;
  bgTimer = window.setTimeout(() => {
    bgTimer = 0;
    const a = useApp.getState();
    if (usePrefs.getState().backgroundPrompted || !a.position || a.bgOffer || a.downloadPrompt || !idle()) return;
    a.patch({ bgOffer: true });
  }, 2500);
}

/** Когда определилось ваше положение — сразу предлагаем сохранить карту района, где вы находитесь. */
function checkHere(): void {
  const prefs = usePrefs.getState();
  const app = useApp.getState();
  if (hereOffered || hereTimer || !app.position || !prefs.onlineMaps || !prefs.askAreaPrompts) return;
  if (!idle() || app.downloadPrompt) return;
  hereTimer = window.setTimeout(() => {
    hereTimer = 0;
    const a = useApp.getState();
    const p = usePrefs.getState();
    if (hereOffered || !a.position || !p.onlineMaps || !p.askAreaPrompts || !idle() || a.downloadPrompt) return;
    hereOffered = true;
    if (isSaved(p.savedAreas, a.position.lng, a.position.lat)) return;
    const { job, key } = hereJob(a.position);
    if (p.dismissedAreas.includes(key)) return;
    shownThisSession.add(key);
    a.patch({ downloadPrompt: { kind: 'area', job, title: job.name, dismissKey: key } });
  }, HERE_DELAY_MS);
}

/** Запускается один раз: следит за состоянием и вовремя показывает вопрос про онлайн-карту. */
export function startPromptWatchers(): () => void {
  const check = () => {
    checkTour();
    checkOnline();
    checkHere();
    checkBackground();
  };
  const offApp = useApp.subscribe(check);
  const offPrefs = usePrefs.subscribe(check);
  check();
  return () => {
    offApp();
    offPrefs();
    clearTimeout(onlineTimer);
    clearTimeout(tourTimer);
    clearTimeout(hereTimer);
    clearTimeout(bgTimer);
    clearTimeout(areaTimer);
  };
}

/** Вызывается после остановки карты: предлагает сохранить область для офлайна. */
export function scheduleAreaCheck(at: { lng: number; lat: number; zoom: number }): void {
  clearTimeout(areaTimer);
  areaTimer = window.setTimeout(() => runAreaCheck(at), AREA_DELAY_MS);
}

export function runAreaCheck(at: { lng: number; lat: number; zoom: number }): void {
  const app = useApp.getState();
  const prefs = usePrefs.getState();
  const current = app.downloadPrompt;
  const stale = () => {
    if (current?.kind === 'area') app.patch({ downloadPrompt: null });
  };
  // предложения имеют смысл, только когда карта подгружается из сети: иначе сохранять нечем
  if (!prefs.onlineMaps || !prefs.askAreaPrompts || at.zoom < PROMPT_MIN_ZOOM || isSaved(prefs.savedAreas, at.lng, at.lat)) return stale();
  const plan = planArea(at.lng, at.lat, at.zoom);
  if (!plan) return stale();
  if (current?.kind === 'area' && current.dismissKey === plan.key) return;
  if (!idle() || (current && current.kind !== 'area')) return;
  if (prefs.dismissedAreas.includes(plan.key) || shownThisSession.has(plan.key)) return stale();
  shownThisSession.add(plan.key);
  const job = areaJob(plan, at);
  app.patch({ downloadPrompt: { kind: 'area', job, title: job.name, dismissKey: plan.key } });
}

/** Для тестов. */
export function resetPromptSession(): void {
  shownThisSession.clear();
  hereOffered = false;
}
