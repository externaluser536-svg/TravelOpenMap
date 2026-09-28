// Уровни и опыт (XP).
//
// XP — производная величина: считается из статистики и выполненных челленджей,
// поэтому всегда согласована с данными (например, после смены исключённых зон).

import type { Stats } from './challenges';

export const MAX_LEVEL = 60;

export const XP_PER_CELL = 2; // за каждую открытую ячейку (~3000 м²)
export const XP_PER_NOTE = 25;
export const XP_PER_PHOTO = 5;
export const XP_PER_VIDEO = 10;
export const M_PER_XP = 50; // 1 XP за каждые 50 м пути

/** Сумма XP, нужная для достижения уровня n. */
export function xpForLevel(n: number): number {
  if (n <= 1) return 0;
  return Math.round(120 * Math.pow(n - 1, 1.7));
}

export interface LevelInfo {
  level: number;
  xp: number;
  /** XP, накопленный внутри текущего уровня */
  into: number;
  /** сколько всего нужно на следующий уровень (от начала текущего) */
  span: number;
  /** 0…1 */
  progress: number;
  /** ключ звания для i18n: title.<n> */
  titleKey: string;
  maxed: boolean;
}

/** Границы званий: минимальный уровень → ключ. */
const TITLES: [number, string][] = [
  [1, 'title.wanderer'],
  [3, 'title.tourist'],
  [5, 'title.traveler'],
  [8, 'title.tracker'],
  [12, 'title.explorer'],
  [17, 'title.pathfinder'],
  [23, 'title.cartographer'],
  [30, 'title.navigator'],
  [40, 'title.legend'],
  [50, 'title.guardian'],
];

export function titleForLevel(level: number): string {
  let key = TITLES[0][1];
  for (const [min, k] of TITLES) if (level >= min) key = k;
  return key;
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  const base = xpForLevel(level);
  const maxed = level >= MAX_LEVEL;
  const next = maxed ? base : xpForLevel(level + 1);
  const span = Math.max(1, next - base);
  const into = xp - base;
  return { level, xp, into, span, progress: maxed ? 1 : Math.min(1, into / span), titleKey: titleForLevel(level), maxed };
}

/** XP за «сырую» активность (без наград за челленджи). */
export function baseXp(s: Pick<Stats, 'cells' | 'notes' | 'photos' | 'videos' | 'distanceM'>): number {
  return (
    s.cells * XP_PER_CELL +
    s.notes * XP_PER_NOTE +
    s.photos * XP_PER_PHOTO +
    s.videos * XP_PER_VIDEO +
    Math.floor(s.distanceM / M_PER_XP)
  );
}
