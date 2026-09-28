import { useCallback } from 'react';
import { usePrefs } from '../state/prefs';
import { ru } from './ru';
import { en } from './en';

const DICTS: Record<string, Record<string, string>> = { ru, en };

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = usePrefs.getState().lang;
  let s = DICTS[lang]?.[key] ?? DICTS.ru[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Склонение: значение словаря вида «заметка|заметки|заметок» (ru) или «note|notes» (en). */
export function tn(key: string, n: number): string {
  const lang = usePrefs.getState().lang;
  const forms = (DICTS[lang]?.[key] ?? DICTS.ru[key] ?? key).split('|');
  if (lang === 'ru') {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    const i = a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2;
    return forms[i] ?? forms[forms.length - 1];
  }
  return forms[Math.abs(n) === 1 ? 0 : 1] ?? forms[0];
}

/** Хук: подписывается на язык, возвращает функции t/tn и текущий язык. */
export function useT() {
  const lang = usePrefs((s) => s.lang);
  const tt = useCallback((key: string, params?: Record<string, string | number>) => t(key, params), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const tnn = useCallback((key: string, n: number) => tn(key, n), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  return { t: tt, tn: tnn, lang };
}
