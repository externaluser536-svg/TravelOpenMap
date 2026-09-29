// Профиль игрока: ник, аватар. Чистая логика (без браузера).

export const NICK_MIN = 2;
export const NICK_MAX = 24;

export type NickCheck = 'ok' | 'empty' | 'short' | 'long' | 'chars';

/** Схлопывает пробелы и обрезает края. */
export const normalizeNick = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Ник: 2–24 символа; буквы любых алфавитов, цифры, пробел, «_», «-», «.»; начинается с буквы или цифры. */
export function checkNickname(raw: string): NickCheck {
  const s = normalizeNick(raw);
  if (!s) return 'empty';
  if ([...s].length < NICK_MIN) return 'short';
  if ([...s].length > NICK_MAX) return 'long';
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(s) ? 'ok' : 'chars';
}

export const AVATAR_ICONS = ['compass', 'mountain', 'trees', 'rocket', 'flame', 'star', 'heart', 'bike', 'plane', 'ship', 'telescope', 'crown'] as const;
export const AVATAR_COLORS = ['#3DDC97', '#6C8CFF', '#FFB547', '#F472B6', '#22D3EE', '#A78BFA', '#FB7185', '#94A3B8'] as const;

/** Детерминированный аватар по нику — подсказка по умолчанию. */
export function suggestAvatar(nick: string): { icon: string; color: string } {
  let h = 0;
  for (const ch of normalizeNick(nick)) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return { icon: AVATAR_ICONS[h % AVATAR_ICONS.length], color: AVATAR_COLORS[(h >>> 4) % AVATAR_COLORS.length] };
}
