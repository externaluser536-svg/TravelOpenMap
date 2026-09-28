import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { usePrefs } from '../state/prefs';

const native = () => Capacitor.isNativePlatform();

export function tap(style: 'light' | 'medium' | 'heavy' = 'light'): void {
  if (!usePrefs.getState().haptics) return;
  if (native()) {
    void Haptics.impact({ style: style === 'heavy' ? ImpactStyle.Heavy : style === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light }).catch(() => {});
  } else if ('vibrate' in navigator) {
    navigator.vibrate(style === 'heavy' ? 30 : style === 'medium' ? 18 : 8);
  }
}

export function success(): void {
  if (!usePrefs.getState().haptics) return;
  if (native()) void Haptics.notification({ type: NotificationType.Success }).catch(() => {});
  else if ('vibrate' in navigator) navigator.vibrate([12, 40, 24]);
}
