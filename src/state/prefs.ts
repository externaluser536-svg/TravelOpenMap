// Настройки пользователя (хранятся в localStorage, переживают перезапуск).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExclusionZone } from '../core/fog';
import type { CompletedMap } from '../core/challenges';
import type { Lang, Units } from '../core/geo';

/** Область, тайлы которой закреплены в кэше и доступны без сети. */
export interface SavedArea {
  id: string;
  name: string;
  flag?: string;
  bbox: [number, number, number, number];
  maxZoom: number;
  /** сохранён ли рельеф (для слоя «Высоты») */
  dem: boolean;
  at: number;
  tiles: number;
  bytes: number;
}

export type ThemePref = 'auto' | 'light' | 'dark';

export interface Prefs {
  lang: Lang;
  units: Units;
  theme: ThemePref;
  /** радиус открытия тумана вокруг игрока, м */
  revealRadius: number;
  /** плотность тумана 0.5…1 */
  fogOpacity: number;
  /** ветер в тумане: 0 — выкл, 1 — лёгкий, 2 — сильный */
  fogWind: number;
  /** игнорировать GPS-фиксы хуже этой точности, м */
  minAccuracy: number;
  recordTrack: boolean;
  haptics: boolean;
  zones: ExclusionZone[];
  completed: CompletedMap;
  onboarded: boolean;
  activeMapId: string;
  developer: boolean;
  /** онлайн-карта: тайлы подгружаются из сети и кэшируются (по умолчанию выключено — приложение офлайн) */
  onlineMaps: boolean;
  /** уже спрашивали про онлайн-карту после знакомства */
  onlinePrompted: boolean;
  /** обучение предложено (принято или отклонено) */
  tutorialSeen: boolean;
  /** дополнительные слои карты */
  mapLayers: { subway: boolean; outdoors: boolean; elevation: boolean };
  /** области, сохранённые для работы без сети */
  savedAreas: SavedArea[];
  /** предел кэша просмотренных тайлов, МБ */
  cacheLimitMb: number;
  /** предлагать скачать карту области при приближении */
  askAreaPrompts: boolean;
  /** радиус кисти для правки тумана, px */
  brushPx: number;
  /** писать трек, пока приложение свёрнуто (Android: служба с уведомлением) */
  backgroundTracking: boolean;
  /** области, для которых предложение отклонено */
  dismissedAreas: string[];
  /** вес для расчёта калорий, кг */
  weightKg: number;
  /** ник игрока (обязателен при первом запуске) */
  nickname: string;
  avatarIcon: string;
  avatarColor: string;
  /** код страны проживания ('' — не указана) */
  homeCountry: string;
}

export const DEFAULT_PREFS: Prefs = {
  lang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en',
  units: 'metric',
  theme: 'auto',
  revealRadius: 60,
  fogOpacity: 0.95,
  fogWind: 1,
  minAccuracy: 60,
  recordTrack: true,
  haptics: true,
  zones: [],
  completed: {},
  onboarded: false,
  activeMapId: 'bundled:monaco',
  developer: false,
  onlineMaps: false,
  onlinePrompted: false,
  tutorialSeen: false,
  mapLayers: { subway: false, outdoors: false, elevation: false },
  savedAreas: [],
  cacheLimitMb: 500,
  askAreaPrompts: true,
  brushPx: 30,
  backgroundTracking: false,
  dismissedAreas: [],
  weightKg: 70,
  nickname: '',
  avatarIcon: 'compass',
  avatarColor: '#3DDC97',
  homeCountry: '',
};

interface PrefsStore extends Prefs {
  set: (p: Partial<Prefs>) => void;
  reset: () => void;
}

export const usePrefs = create<PrefsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      set: (p) => set(p),
      reset: () => set({ ...DEFAULT_PREFS }),
    }),
    {
      name: 'tom.prefs.v1',
      partialize: (s) => {
        const { set: _s, reset: _r, ...rest } = s;
        return rest;
      },
    },
  ),
);

/** Реальная тема с учётом «авто» (по системной настройке). */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'auto') return pref;
  if (typeof matchMedia === 'undefined') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
