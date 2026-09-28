// Челленджи: постоянные достижения и ежедневные задания.

export interface Stats {
  /** открытых ячеек вне исключённых зон */
  cells: number;
  areaM2: number;
  distanceM: number;
  notes: number;
  photos: number;
  videos: number;
  /** сколько разных категорий заметок использовано */
  categories: number;
  activeDays: number;
  streak: number;
  bestStreak: number;
  bestDayDistanceM: number;
  earlyNotes: number;
  nightNotes: number;
  today: { cells: number; areaM2: number; distanceM: number; notes: number };
}

export const EMPTY_STATS: Stats = {
  cells: 0,
  areaM2: 0,
  distanceM: 0,
  notes: 0,
  photos: 0,
  videos: 0,
  categories: 0,
  activeDays: 0,
  streak: 0,
  bestStreak: 0,
  bestDayDistanceM: 0,
  earlyNotes: 0,
  nightNotes: 0,
  today: { cells: 0, areaM2: 0, distanceM: 0, notes: 0 },
};

export type ChallengeGroup = 'explore' | 'distance' | 'notes' | 'media' | 'streak' | 'special';

export interface ChallengeDef {
  id: string;
  group: ChallengeGroup;
  /** имя иконки lucide (см. ui/icons.ts) */
  icon: string;
  value: (s: Stats) => number;
  target: number;
  /** формат значения для подписи прогресса */
  unit: 'km2' | 'km' | 'count' | 'days';
  xp: number;
}

const km2 = (n: number) => n * 1e6;
const km = (n: number) => n * 1000;

export const CHALLENGES: ChallengeDef[] = [
  // --- Исследование (площадь) ---
  { id: 'area_01', group: 'explore', icon: 'footprints', value: (s) => s.areaM2, target: km2(0.1), unit: 'km2', xp: 40 },
  { id: 'area_05', group: 'explore', icon: 'map', value: (s) => s.areaM2, target: km2(0.5), unit: 'km2', xp: 80 },
  { id: 'area_1', group: 'explore', icon: 'square', value: (s) => s.areaM2, target: km2(1), unit: 'km2', xp: 150 },
  { id: 'area_25', group: 'explore', icon: 'binoculars', value: (s) => s.areaM2, target: km2(2.5), unit: 'km2', xp: 250 },
  { id: 'area_5', group: 'explore', icon: 'compass', value: (s) => s.areaM2, target: km2(5), unit: 'km2', xp: 400 },
  { id: 'area_10', group: 'explore', icon: 'mountain', value: (s) => s.areaM2, target: km2(10), unit: 'km2', xp: 700 },
  { id: 'area_25b', group: 'explore', icon: 'globe', value: (s) => s.areaM2, target: km2(25), unit: 'km2', xp: 1200 },
  { id: 'area_50', group: 'explore', icon: 'telescope', value: (s) => s.areaM2, target: km2(50), unit: 'km2', xp: 2000 },
  { id: 'area_100', group: 'explore', icon: 'crown', value: (s) => s.areaM2, target: km2(100), unit: 'km2', xp: 3500 },
  // --- Дистанция ---
  { id: 'dist_1', group: 'distance', icon: 'route', value: (s) => s.distanceM, target: km(1), unit: 'km', xp: 30 },
  { id: 'dist_5', group: 'distance', icon: 'route', value: (s) => s.distanceM, target: km(5), unit: 'km', xp: 80 },
  { id: 'dist_10', group: 'distance', icon: 'footprints', value: (s) => s.distanceM, target: km(10), unit: 'km', xp: 150 },
  { id: 'dist_42', group: 'distance', icon: 'medal', value: (s) => s.distanceM, target: km(42.2), unit: 'km', xp: 400 },
  { id: 'dist_100', group: 'distance', icon: 'flame', value: (s) => s.distanceM, target: km(100), unit: 'km', xp: 800 },
  { id: 'dist_250', group: 'distance', icon: 'rocket', value: (s) => s.distanceM, target: km(250), unit: 'km', xp: 1500 },
  { id: 'dist_1000', group: 'distance', icon: 'trophy', value: (s) => s.distanceM, target: km(1000), unit: 'km', xp: 4000 },
  // --- Заметки ---
  { id: 'notes_1', group: 'notes', icon: 'pin', value: (s) => s.notes, target: 1, unit: 'count', xp: 30 },
  { id: 'notes_5', group: 'notes', icon: 'notebook', value: (s) => s.notes, target: 5, unit: 'count', xp: 80 },
  { id: 'notes_15', group: 'notes', icon: 'bookmark', value: (s) => s.notes, target: 15, unit: 'count', xp: 200 },
  { id: 'notes_50', group: 'notes', icon: 'library', value: (s) => s.notes, target: 50, unit: 'count', xp: 600 },
  { id: 'notes_100', group: 'notes', icon: 'award', value: (s) => s.notes, target: 100, unit: 'count', xp: 1200 },
  // --- Медиа ---
  { id: 'photo_10', group: 'media', icon: 'camera', value: (s) => s.photos, target: 10, unit: 'count', xp: 100 },
  { id: 'photo_50', group: 'media', icon: 'images', value: (s) => s.photos, target: 50, unit: 'count', xp: 500 },
  { id: 'video_1', group: 'media', icon: 'video', value: (s) => s.videos, target: 1, unit: 'count', xp: 60 },
  { id: 'video_10', group: 'media', icon: 'clapperboard', value: (s) => s.videos, target: 10, unit: 'count', xp: 400 },
  // --- Серии ---
  { id: 'streak_3', group: 'streak', icon: 'flame', value: (s) => s.bestStreak, target: 3, unit: 'days', xp: 80 },
  { id: 'streak_7', group: 'streak', icon: 'calendar', value: (s) => s.bestStreak, target: 7, unit: 'days', xp: 250 },
  { id: 'streak_14', group: 'streak', icon: 'calendar', value: (s) => s.bestStreak, target: 14, unit: 'days', xp: 600 },
  { id: 'streak_30', group: 'streak', icon: 'zap', value: (s) => s.bestStreak, target: 30, unit: 'days', xp: 1500 },
  // --- Особые ---
  { id: 'sp_categories', group: 'special', icon: 'layers', value: (s) => s.categories, target: 5, unit: 'count', xp: 150 },
  { id: 'sp_early', group: 'special', icon: 'sunrise', value: (s) => s.earlyNotes, target: 1, unit: 'count', xp: 120 },
  { id: 'sp_night', group: 'special', icon: 'moon', value: (s) => s.nightNotes, target: 1, unit: 'count', xp: 120 },
  { id: 'sp_day10', group: 'special', icon: 'gauge', value: (s) => s.bestDayDistanceM, target: km(10), unit: 'km', xp: 300 },
];

export const GROUP_ORDER: ChallengeGroup[] = ['explore', 'distance', 'notes', 'media', 'streak', 'special'];

export interface ChallengeState {
  def: ChallengeDef;
  value: number;
  progress: number; // 0…1
  done: boolean;
  doneAt?: number;
}

export type CompletedMap = Record<string, number>;

export function evaluateChallenges(stats: Stats, completed: CompletedMap): ChallengeState[] {
  return CHALLENGES.map((def) => {
    const value = def.value(stats);
    const progress = Math.max(0, Math.min(1, value / def.target));
    const doneAt = completed[def.id];
    return { def, value, progress, done: progress >= 1 || doneAt !== undefined, doneAt };
  });
}

/** Челленджи, которые выполнены сейчас, но ещё не занесены в `completed`. */
export function newlyCompleted(stats: Stats, completed: CompletedMap): ChallengeDef[] {
  return CHALLENGES.filter((d) => completed[d.id] === undefined && d.value(stats) >= d.target);
}

// ---------- Ежедневные задания ----------

export interface DailyQuest {
  id: string; // daily:YYYY-MM-DD:n
  kind: 'distance' | 'area' | 'notes';
  icon: string;
  target: number;
  unit: 'km' | 'km2' | 'count';
  xp: number;
  value: number;
  progress: number;
  done: boolean;
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dailyQuests(date: string, today: Stats['today'], completed: CompletedMap): DailyQuest[] {
  const h = hash(date);
  const distKm = [1, 1.5, 2, 3, 5][h % 5];
  const areaKm2 = [0.03, 0.05, 0.08, 0.12][(h >>> 3) % 4];
  const notes = [1, 2, 3][(h >>> 6) % 3];
  const mk = (n: number, kind: DailyQuest['kind'], icon: string, target: number, unit: DailyQuest['unit'], xp: number, value: number): DailyQuest => {
    const id = `daily:${date}:${n}`;
    const progress = Math.min(1, value / target);
    return { id, kind, icon, target, unit, xp, value, progress, done: progress >= 1 || completed[id] !== undefined };
  };
  return [
    mk(0, 'distance', 'route', km(distKm), 'km', 40 + distKm * 10, today.distanceM),
    mk(1, 'area', 'map', km2(areaKm2), 'km2', 50 + Math.round(areaKm2 * 300), today.areaM2),
    mk(2, 'notes', 'pin', notes, 'count', 30 + notes * 15, today.notes),
  ];
}

export function newlyCompletedDaily(quests: DailyQuest[], completed: CompletedMap): DailyQuest[] {
  return quests.filter((q) => completed[q.id] === undefined && q.progress >= 1);
}
