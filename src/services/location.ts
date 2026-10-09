// Геолокация. На устройстве — нативный плагин Capacitor, в браузере — Geolocation API.

import { Geolocation, type Position } from '@capacitor/geolocation';
import { useApp, type Fix } from '../state/store';
import { engine } from '../state/engine';
import { usePrefs } from '../state/prefs';
import { t } from '../i18n';
import { BackgroundTracker, FixReplayer, backgroundSupported, toFix as nativeToFix } from './background';

let watchId: string | null = null;
let webWatchId: number | null = null;
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

// ---------------------------------------------------------------- GPS выключен в настройках телефона (Android)
let watchdog = 0;

/** Пока сигнала нет, раз в несколько секунд проверяем, не выключена ли геолокация в системе, и подсказываем это. */
function startGpsWatchdog(): void {
  if (watchdog || !backgroundSupported()) return;
  watchdog = window.setInterval(() => {
    const st = useApp.getState();
    if (st.gps !== 'searching' && st.gps !== 'disabled') return;
    void BackgroundTracker.gpsState().then(
      (r) => {
        const cur = useApp.getState().gps;
        if (!r.enabled && cur === 'searching') useApp.getState().patch({ gps: 'disabled' });
        else if (r.enabled && cur === 'disabled') useApp.getState().patch({ gps: 'searching' });
      },
      () => {},
    );
  }, 6000);
}

function stopGpsWatchdog(): void {
  clearInterval(watchdog);
  watchdog = 0;
}

// ---------------------------------------------------------------- фоновая запись (Android)
let bg: { replayer: FixReplayer; handle: { remove: () => Promise<void> } | null; onVisible: () => void } | null = null;

async function catchUpBackground(): Promise<void> {
  if (!bg) return;
  await bg.replayer.catchUp(async () => {
    const r = await BackgroundTracker.drain();
    // запись остановили кнопкой в уведомлении — выключаем настройку и возвращаемся к обычному режиму
    if (!r.running && usePrefs.getState().backgroundTracking) {
      usePrefs.getState().set({ backgroundTracking: false });
      useApp.getState().toast({ kind: 'info', title: t('bg.stopped'), icon: 'info' });
      queueMicrotask(() => void restartLocation());
    }
    return r.fixes.map(nativeToFix);
  });
}

async function startBackground(): Promise<boolean> {
  try {
    const imperial = usePrefs.getState().units === 'imperial';
    await BackgroundTracker.start({
      title: t('bg.notif_title'),
      text: t('bg.notif_text'),
      stop: t('bg.notif_stop'),
      searching: t('bg.notif_searching'),
      channel: t('bg.notif_channel'),
      u1: t(imperial ? 'unit.mi' : 'unit.km'),
      u2: t(imperial ? 'unit.ft' : 'unit.m'),
      imperial,
    });
  } catch (e) {
    if ((e as { message?: string })?.message === 'location-denied') useApp.getState().patch({ gps: 'denied' });
    return false;
  }
  const replayer = new FixReplayer((f) => engine.onFix(f));
  const handle = await BackgroundTracker.addListener('fix', (n) => replayer.live(nativeToFix(n)));
  const onVisible = () => {
    if (document.visibilityState === 'visible') void catchUpBackground();
  };
  document.addEventListener('visibilitychange', onVisible);
  bg = { replayer, handle, onVisible };
  await catchUpBackground();
  return true;
}

async function stopBackground(): Promise<void> {
  if (!bg) return;
  const b = bg;
  bg = null;
  document.removeEventListener('visibilitychange', b.onVisible);
  await b.handle?.remove().catch(() => {});
  await BackgroundTracker.stop().catch(() => {});
}

/** Включает или выключает фоновую запись и перезапускает определение положения. */
export async function setBackgroundTracking(on: boolean): Promise<void> {
  usePrefs.getState().set({ backgroundTracking: on });
  await restartLocation();
}

async function restartLocation(): Promise<void> {
  await stopLocation();
  await startLocation();
}

export async function startLocation(): Promise<void> {
  if (watchId || starting || bg) return;
  starting = true;
  const app = useApp.getState();
  try {
    app.patch({ gps: 'searching' });
    startGpsWatchdog();
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
    if (usePrefs.getState().backgroundTracking && backgroundSupported()) {
      if (await startBackground()) return;
      usePrefs.getState().set({ backgroundTracking: false }); // не удалось — остаёмся на обычной записи
    }
    watchId = await Geolocation.watchPosition(
      // enableLocationFallback: без сервисов Google Play плагин сам переключается на системный LocationManager (GPS)
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 2000, enableLocationFallback: true },
      (pos, err) => {
        if (err || !pos) {
          const e = err as { code?: number | string; message?: string } | undefined;
          const text = `${e?.code ?? ''} ${e?.message ?? ''}`;
          if (e?.code === 1 || /denied|permission/i.test(text)) useApp.getState().patch({ gps: 'denied' });
          // тайм-аут — слабый сигнал: наблюдение продолжается само, запасной путь не нужен (иначе точки пошли бы дважды)
          else if (e?.code === 3 || /time.?out|timed out/i.test(text)) {
            if (!['ok', 'weak', 'disabled'].includes(useApp.getState().gps)) useApp.getState().patch({ gps: 'searching' });
          } else if (!startWebFallback()) useApp.getState().patch({ gps: 'unavailable' });
          return;
        }
        engine.onFix(toFix(pos));
      },
    );
  } catch {
    if (!startWebFallback()) useApp.getState().patch({ gps: 'unavailable' });
  } finally {
    starting = false;
  }
}

/**
 * Запасной путь: Geolocation API системного WebView (на Android он тоже работает через LocationManager).
 * Включается, если нативный плагин вернул ошибку не из-за запрета доступа.
 */
export function startWebFallback(): boolean {
  if (webWatchId !== null) return true;
  if (typeof navigator === 'undefined' || !navigator.geolocation) return false;
  webWatchId = navigator.geolocation.watchPosition(
    (p) =>
      engine.onFix({
        lng: p.coords.longitude,
        lat: p.coords.latitude,
        accuracy: p.coords.accuracy,
        heading: p.coords.heading,
        speed: p.coords.speed,
        t: p.timestamp || Date.now(),
      }),
    (e) => {
      const st = useApp.getState();
      if (e.code === 1) st.patch({ gps: 'denied' });
      else if (e.code === 3) {
        if (!['ok', 'weak', 'disabled'].includes(st.gps)) st.patch({ gps: 'searching' }); // тайм-аут — сигнал слабый, наблюдение продолжается
      } else st.patch({ gps: 'unavailable' });
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 2000 },
  );
  return true;
}

export async function stopLocation(): Promise<void> {
  stopGpsWatchdog();
  await stopBackground();
  if (webWatchId !== null) {
    navigator.geolocation.clearWatch(webWatchId);
    webWatchId = null;
  }
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
