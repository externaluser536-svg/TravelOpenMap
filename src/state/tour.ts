// Обучение при первом запуске: предложение (можно принять или отказаться) и пошаговый показ интерфейса.

import { useApp } from './store';
import { usePrefs } from './prefs';
import { tap } from '../services/haptics';

/** Шаги. target — значение атрибута data-tour у подсвечиваемого элемента; без него подсказка по центру. */
export interface TourStep {
  id: string;
  target?: string;
}

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'fog' },
  { id: 'stats', target: 'stats' },
  { id: 'locate', target: 'locate' },
  { id: 'peek', target: 'peek' },
  { id: 'fogedit', target: 'fogedit' },
  { id: 'layers', target: 'layers' },
  { id: 'add', target: 'add' },
  { id: 'notes', target: 'tab-notes' },
  { id: 'workout', target: 'tab-workout' },
  { id: 'profile', target: 'tab-profile' },
  { id: 'maps' },
  { id: 'background' },
  { id: 'done' },
];

/** Начинает обучение с первого шага (из предложения или из настроек). */
export function startTour(): void {
  tap('light');
  useApp.getState().patch({ tourOffer: false, tour: { step: 0 }, screen: 'map', sheet: null, mode: 'normal', mapMenu: null, peek: false });
}

/** «Пройти обучение» в окне-предложении. */
export function acceptTour(): void {
  usePrefs.getState().set({ tutorialSeen: true });
  startTour();
}

/** «Пропустить»: больше не спрашиваем, повторить можно в настройках. */
export function declineTour(): void {
  usePrefs.getState().set({ tutorialSeen: true });
  useApp.getState().patch({ tourOffer: false });
}

export function goTour(step: number): void {
  if (step < 0) return;
  if (step >= TOUR_STEPS.length) return endTour();
  tap('light');
  useApp.getState().patch({ tour: { step } });
}

export function endTour(): void {
  usePrefs.getState().set({ tutorialSeen: true });
  useApp.getState().patch({ tour: null, tourOffer: false });
}
