import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, AVATAR_ICONS, checkNickname, normalizeNick, suggestAvatar } from '../src/core/profile';

describe('ник', () => {
  it('принимает буквы разных алфавитов, цифры и разрешённые знаки', () => {
    for (const n of ['Алекс', 'Alex', 'Юлия_К', 'Max 2000', 'jean-luc', '李雷', 'a.b']) expect(checkNickname(n), n).toBe('ok');
  });
  it('пустой, короткий, длинный', () => {
    expect(checkNickname('')).toBe('empty');
    expect(checkNickname('   ')).toBe('empty');
    expect(checkNickname('A')).toBe('short');
    expect(checkNickname('  б  ')).toBe('short');
    expect(checkNickname('x'.repeat(25))).toBe('long');
    expect(checkNickname('x'.repeat(24))).toBe('ok');
  });
  it('запрещает спецсимволы и начало с знака', () => {
    for (const n of ['<b>hi</b>', 'a@b', '_alex', '-x-', 'a/b', 'hi!']) expect(checkNickname(n), n).toBe('chars');
  });
  it('нормализация схлопывает пробелы', () => {
    expect(normalizeNick('  Иван   Иванов ')).toBe('Иван Иванов');
  });
  it('подбор аватара детерминирован и берёт значения из наборов', () => {
    const a = suggestAvatar('Алекс');
    expect(suggestAvatar('  Алекс ')).toEqual(a);
    expect(AVATAR_ICONS).toContain(a.icon);
    expect(AVATAR_COLORS).toContain(a.color);
  });
});
