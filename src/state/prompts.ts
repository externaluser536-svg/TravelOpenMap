// Когда задавать вопросы про карты: онлайн-карта после знакомства и сохранение области при приближении.
// Ничего не скачивается без согласия пользователя — здесь только решаем, когда показать вопрос.

import { checkNickname } from '../core/profile';
import { PROMPT_MIN_ZOOM, planArea } from '../core/regions';
import { isSaved } from '../map/offline-areas';
import { usePrefs } from './prefs';
import { useApp } from './store';
import { areaJob } from './downloads';

const AREA_DELAY_MS = 1200;
const ONLINE_DELAY_MS = 1500;

/** Области, о которых уже спрашивали в этой сессии («Позже» не значит «никогда»). */
const shownThisSession = new Set<string>();
let areaTimer = 0;
let onlineTimer = 0;

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

/** Запускается один раз: следит за состоянием и вовремя показывает вопрос про онлайн-карту. */
export function startPromptWatchers(): () => void {
  const offApp = useApp.subscribe(checkOnline);
  const offPrefs = usePrefs.subscribe(checkOnline);
  checkOnline();
  return () => {
    offApp();
    offPrefs();
    clearTimeout(onlineTimer);
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
}
