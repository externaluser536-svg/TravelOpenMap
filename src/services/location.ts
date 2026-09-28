// Геолокация. На устройстве — нативный плагин Capacitor, в браузере — Geolocation API.

import { Geolocation, type Position } from '@capacitor/geolocation';
import { useApp, type Fix } from '../state/store';
import { engine } from '../state/engine';

let watchId: string | null = null;
let starting = false;

function toFix(p: Position): Fix {
  return {
    lng: p.coords.longitude,
    lat: p.coords.latitude,
    accuracy: p.coords.accuracy,
    heading: p.coords.heading,
    speed: p.coords.speed,
    t: p.timestamp || Date.now(),
  };
}

export async function startLocation(): Promise<void> {
  if (watchId || starting) return;
  starting = true;
  const app = useApp.getState();
  try {
    app.patch({ gps: 'searching' });
    try {
      const perm = await Geolocation.checkPermissions();
      if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location === 'denied' && req.coarseLocation === 'denied') {
          app.patch({ gps: 'denied' });
          return;
        }
      }
    } catch {
      // на вебе checkPermissions может не поддерживаться — продолжаем, браузер сам спросит
    }
    watchId = await Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 2000 },
      (pos, err) => {
        if (err || !pos) {
          const code = (err as { code?: number } | undefined)?.code;
          useApp.getState().patch({ gps: code === 1 ? 'denied' : 'unavailable' });
          return;
        }
        engine.onFix(toFix(pos));
      },
    );
  } catch {
    useApp.getState().patch({ gps: 'unavailable' });
  } finally {
    starting = false;
  }
}

export async function stopLocation(): Promise<void> {
  if (!watchId) return;
  const id = watchId;
  watchId = null;
  try {
    await Geolocation.clearWatch({ id });
  } catch {
    /* ignore */
  }
  useApp.getState().patch({ gps: 'off' });
}
