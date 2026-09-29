// Настройки пользователя (хранятся в localStorage, переживают перезапуск).

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExclusionZone } from '../core/fog';
import type { CompletedMap } from '../core/challenges';
import type { Lang, Units } from '../core/geo';

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
  /** разрешена ли загрузка карт из сети (по умолчанию — нет: приложение полностью офлайн) */
  allowDownloads: boolean;
  /** URL источника карт: PMTiles-файл (например, сборка Protomaps) */
  mapSourceUrl: string;
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
  allowDownloads: false,
  mapSourceUrl: '',
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
