// Компас на датчиках ориентации устройства (магнитометр + акселерометр).

import { useApp } from '../state/store';
import { normDeg } from '../core/geo';

type OrientationEventCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };

let active = false;
let smoothed: number | null = null;
let lastPublish = 0;

function screenAngle(): number {
  return (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : 0) || 0;
}

export function publishHeading(raw: number): void {
  // круговое экспоненциальное сглаживание, чтобы стрелка не дрожала
  const h = normDeg(raw);
  if (smoothed === null) smoothed = h;
  else {
    let d = h - smoothed;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    smoothed = normDeg(smoothed + d * 0.3);
  }
  const now = performance.now();
  if (now - lastPublish < 60) return;
  lastPublish = now;
  useApp.getState().patch({ heading: smoothed, compassAvailable: true });
}

function onAbsolute(e: DeviceOrientationEvent): void {
  if (e.alpha === null || e.alpha === undefined) return;
  publishHeading(360 - e.alpha + screenAngle());
}

function onOrientation(e: DeviceOrientationEvent): void {
  const w = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
  if (typeof w.webkitCompassHeading === 'number') {
    publishHeading(w.webkitCompassHeading + screenAngle()); // iOS
  } else if (e.absolute && e.alpha !== null) {
    publishHeading(360 - e.alpha + screenAngle());
  }
}

export function compassSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

export function needsPermission(): boolean {
  return compassSupported() && typeof (DeviceOrientationEvent as OrientationEventCtor).requestPermission === 'function';
}

export async function startCompass(userGesture = false): Promise<void> {
  if (active || !compassSupported()) return;
  const ctor = DeviceOrientationEvent as OrientationEventCtor;
  if (needsPermission()) {
    if (!userGesture) {
      useApp.getState().patch({ compassNeedsPermission: true });
      return;
    }
    try {
      if ((await ctor.requestPermission!()) !== 'granted') return;
    } catch {
      return;
    }
    useApp.getState().patch({ compassNeedsPermission: false });
  }
  active = true;
  const w = window as unknown as Record<string, unknown>;
  if ('ondeviceorientationabsolute' in w) window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
  else window.addEventListener('deviceorientation', onOrientation as EventListener, true);
}

export function stopCompass(): void {
  if (!active) return;
  active = false;
  window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener, true);
  window.removeEventListener('deviceorientation', onOrientation as EventListener, true);
}
