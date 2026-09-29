// Когда предлагать скачать карту: обзор мира после знакомства и область при приближении.
// Ничего не скачивается без согласия пользователя — здесь только решаем, когда показать вопрос.

import { checkNickname } from '../core/profile';
import { PROMPT_MIN_ZOOM, hasDetail, hasWorld, planArea } from '../core/regions';
import { usePrefs } from './prefs';
import { useApp } from './store';
import { areaJob, worldJob } from './downloads';

const AREA_DELAY_MS = 1200;
const WORLD_DELAY_MS = 1500;

/** Области, о которых уже спрашивали в этой сессии («Позже» не значит «никогда»). */
const shownThisSession = new Set<string>();
let areaTimer = 0;
let worldTimer = 0;

/** Можно ли сейчас показывать вопросы: знакомство пройдено, открыта карта, ничего другого не мешает. */
function idle(): boolean {
  const app = useApp.getState();
  const prefs = usePrefs.getState();
  return (
    prefs.onboarded &&
    checkNickname(prefs.nickname) === 'ok' &&
    app.screen === 'map' &&
    !!app.mapInfo &&
    app.mode === 'normal' &&
    !app.sheet &&
    !app.levelUp &&
    app.workoutLive === null &&
    app.download?.state !== 'running'
  );
}

function checkWorld(): void {
  const prefs = usePrefs.getState();
  const app = useApp.getState();
  if (prefs.worldPrompted) return;
  if (app.mapSources.length && hasWorld(app.mapSources)) {
    prefs.set({ worldPrompted: true });
    return;
  }
  if (worldTimer || !idle() || app.downloadPrompt) return;
  // подписка срабатывает на каждое обновление состояния — таймер ставим один раз, а условия перепроверяем по его истечении
  worldTimer = window.setTimeout(() => {
    worldTimer = 0;
    if (usePrefs.getState().worldPrompted || !idle() || useApp.getState().downloadPrompt) return;
    useApp.getState().patch({ downloadPrompt: { kind: 'world', job: worldJob() } });
  }, WORLD_DELAY_MS);
}

/** Запускается один раз: следит за состоянием и вовремя показывает вопрос про обзор мира. */
export function startPromptWatchers(): () => void {
  const offApp = useApp.subscribe(checkWorld);
  const offPrefs = usePrefs.subscribe(checkWorld);
  checkWorld();
  return () => {
    offApp();
    offPrefs();
    clearTimeout(worldTimer);
    clearTimeout(areaTimer);
  };
}

/** Вызывается после остановки карты: предлагает область, если рядом нет подробной карты. */
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
  if (!prefs.askAreaPrompts || !prefs.worldPrompted || at.zoom < PROMPT_MIN_ZOOM || hasDetail(app.mapSources, at.lng, at.lat)) return stale();
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
