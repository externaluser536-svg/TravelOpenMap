import type { Units } from '../core/geo';
import { formatPace } from '../core/workout';

export const paceText = (paceS: number | null, units: Units): string => `${formatPace(paceS, units === 'imperial')}`;
export const paceUnit = (units: Units, unitKm: string): string => (units === 'imperial' ? '/mi' : `/${unitKm}`);

/** Скорость, м/с → «км/ч» или «mph». */
export function speedText(mps: number, units: Units): string {
  const v = units === 'imperial' ? mps * 2.236936 : mps * 3.6;
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}
export const speedUnit = (units: Units, kmh: string): string => (units === 'imperial' ? 'mph' : kmh);

export function distNum(m: number, units: Units): string {
  const v = units === 'imperial' ? m / 1609.344 : m / 1000;
  return v < 10 ? v.toFixed(2) : v.toFixed(1);
}

/** Размер файла: «418 KB», «15 MB», «4.0 GB». */
export function fmtBytes(b: number): string {
  return b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.max(1, Math.round(b / 1e6))} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`;
}
