// Фоновая запись трека. На Android — собственный плагин BackgroundTracker (служба переднего плана + системный
// LocationManager, без сервисов Google Play). Пока приложение свёрнуто, точки копятся в очереди на устройстве;
// при возвращении их забирают одной операцией и по порядку проигрывают в движок тумана — след рисуется целиком.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { Fix } from '../state/store';

export interface NativeFix {
  lng: number;
  lat: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  t: number;
}

interface BackgroundTrackerPlugin {
  start(o: { title: string; text: string; stopLabel: string }): Promise<{ running: boolean }>;
  stop(): Promise<void>;
  drain(): Promise<{ fixes: NativeFix[]; running: boolean }>;
  status(): Promise<{ running: boolean; requested: boolean }>;
  addListener(event: 'fix', cb: (f: NativeFix) => void): Promise<PluginListenerHandle>;
}

export const BackgroundTracker = registerPlugin<BackgroundTrackerPlugin>('BackgroundTracker');

/** Есть ли на этом устройстве фоновая запись (пока — Android-сборка с нашим плагином). */
export function backgroundSupported(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('BackgroundTracker');
}

export function toFix(n: NativeFix): Fix {
  return { lng: n.lng, lat: n.lat, accuracy: n.accuracy, heading: n.heading ?? null, speed: n.speed ?? null, t: n.t };
}

/**
 * Собирает точки в правильном порядке: сначала накопленные в очереди (по времени), затем пришедшие вживую.
 * Пока идёт «догон», живые точки ждут в буфере, поэтому новая точка никогда не обгонит старую.
 */
export class FixReplayer {
  private buffering = true;
  private buf: Fix[] = [];
  private lastT = -Infinity;
  constructor(
    private readonly sink: (f: Fix) => void,
    private readonly yieldEvery = 200,
  ) {}

  /** Точка, пришедшая вживую. */
  live(f: Fix): void {
    if (this.buffering) this.buf.push(f);
    else this.push(f);
  }

  /** Возвращаемся в приложение: проигрываем накопленное, затем то, что успело прийти. */
  async catchUp(load: () => Promise<Fix[]>): Promise<number> {
    this.buffering = true;
    const old = (await load()).slice().sort((a, b) => a.t - b.t);
    let n = 0;
    for (const f of old) {
      this.push(f);
      n++;
      if (n % this.yieldEvery === 0) await new Promise((r) => setTimeout(r, 0)); // не подвешиваем интерфейс на длинных треках
    }
    const rest = this.buf.splice(0).sort((a, b) => a.t - b.t);
    for (const f of rest) this.push(f);
    this.buffering = false;
    return n + rest.length;
  }

  private push(f: Fix): void {
    if (f.t <= this.lastT) return; // повтор или точка из прошлого — пропускаем
    this.lastT = f.t;
    this.sink(f);
  }
}
