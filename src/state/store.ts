// Оперативное состояние приложения (не сохраняется).

import { create } from 'zustand';
import type { Stats, ChallengeState, DailyQuest } from '../core/challenges';
import { EMPTY_STATS } from '../core/challenges';
import { levelFromXp, type LevelInfo } from '../core/levels';
import type { LngLat } from '../core/geo';
import type { Note, Trip, Workout, WorkoutType } from '../data/db';
import type { DayLog } from '../core/days';
import type { LiveStats } from '../core/workout';
import type { Progress } from '../map/gateway-client';
import type { MapInfo } from '../map/pmtiles';

export type Screen = 'map' | 'notes' | 'workout' | 'profile';
export type ProfileTab = 'stats' | 'quests' | 'trips';
export type MapMode = 'normal' | 'measure' | 'pick' | 'zone';
export type GpsStatus = 'off' | 'searching' | 'ok' | 'weak' | 'denied' | 'unavailable';

export interface Fix {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number | null;
  speed?: number | null;
  t: number;
}

export type Sheet =
  | null
  | { type: 'note'; id: string }
  | { type: 'editor' }
  | { type: 'compass' }
  | { type: 'settings' }
  | { type: 'maps' }
  | { type: 'zones' }
  | { type: 'data' }
  | { type: 'privacy' }
  | { type: 'countries' }
  | { type: 'country'; code: string }
  | { type: 'workout'; id: string }
  | { type: 'trip'; id: string }
  | { type: 'tripEditor' };

export interface DraftMedia {
  key: string;
  kind: 'photo' | 'video';
  blob: Blob;
  thumb?: Blob;
  mime: string;
  width?: number;
  height?: number;
  /** id уже сохранённой записи (при редактировании) */
  existingId?: string;
}

export interface NoteDraft {
  id?: string;
  title: string;
  text: string;
  category: string;
  lng: number;
  lat: number;
  media: DraftMedia[];
  removedMediaIds: string[];
  /** координаты выбраны вручную на карте */
  manual: boolean;
}

export interface ZoneDraft {
  id?: string;
  name: string;
  lng: number;
  lat: number;
  radius: number;
}

export interface DownloadState {
  code: string;
  name: string;
  state: 'running' | 'done' | 'error';
  progress?: Progress;
  error?: string;
}

export interface Toast {
  id: number;
  kind: 'quest' | 'info' | 'error' | 'daily';
  title: string;
  text?: string;
  icon?: string;
  xp?: number;
}

export interface AppState {
  screen: Screen;
  profileTab: ProfileTab;
  sheet: Sheet;
  mode: MapMode;
  peek: boolean;
  follow: boolean;
  mapBearing: number;
  orientMap: boolean;

  position: Fix | null;
  gps: GpsStatus;
  inZone: boolean;
  heading: number | null;
  compassAvailable: boolean;
  compassNeedsPermission: boolean;

  notes: Note[];
  stats: Stats;
  level: LevelInfo;
  challenges: ChallengeState[];
  quests: DailyQuest[];
  lastDays: { date: string; distanceM: number; areaM2: number; notes: number }[];
  /** вся история по дням (для графиков) */
  allDays: DayLog[];
  /** минуты движения по часам суток */
  hours: number[];
  ready: boolean;

  workouts: Workout[];
  /** активная тренировка (null — нет) */
  workoutLive: (LiveStats & { type: WorkoutType }) | null;
  workoutRoute: [number, number][];
  trips: Trip[];
  tripDraft: Trip | null;
  download: DownloadState | null;

  mapInfo: MapInfo | null;
  mapMissing: boolean;

  selectedNoteId: string | null;
  compassTarget: { lng: number; lat: number; name: string } | null;
  measurePoints: LngLat[];
  draft: NoteDraft | null;
  zoneDraft: ZoneDraft | null;

  toasts: Toast[];
  levelUp: LevelInfo | null;
  flyTo: { lng: number; lat: number; zoom?: number; nonce: number } | null;
  fitBounds: { bounds: [number, number, number, number]; nonce: number } | null;

  patch: (p: Partial<AppState>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  openSheet: (s: Sheet) => void;
  closeSheet: () => void;
  goTo: (p: { lng: number; lat: number; zoom?: number }) => void;
}

let toastId = 1;

export const useApp = create<AppState>((set, get) => ({
  screen: 'map',
  profileTab: 'stats',
  sheet: null,
  mode: 'normal',
  peek: false,
  follow: true,
  mapBearing: 0,
  orientMap: false,

  position: null,
  gps: 'off',
  inZone: false,
  heading: null,
  compassAvailable: false,
  compassNeedsPermission: false,

  notes: [],
  stats: EMPTY_STATS,
  level: levelFromXp(0),
  challenges: [],
  quests: [],
  lastDays: [],
  allDays: [],
  hours: Array(24).fill(0),
  ready: false,

  workouts: [],
  workoutLive: null,
  workoutRoute: [],
  trips: [],
  tripDraft: null,
  download: null,

  mapInfo: null,
  mapMissing: false,

  selectedNoteId: null,
  compassTarget: null,
  measurePoints: [],
  draft: null,
  zoneDraft: null,

  toasts: [],
  levelUp: null,
  flyTo: null,
  fitBounds: null,

  patch: (p) => set(p),
  toast: (t) => {
    const id = toastId++;
    set({ toasts: [...get().toasts, { ...t, id }].slice(-3) });
    setTimeout(() => get().dismissToast(id), t.kind === 'error' ? 6000 : 4200);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
  openSheet: (s) => set({ sheet: s }),
  closeSheet: () => set({ sheet: null }),
  goTo: (p) => set({ flyTo: { ...p, nonce: Date.now() + Math.random() }, follow: false }),
}));
