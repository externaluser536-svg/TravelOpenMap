// Клиент сетевого шлюза загрузки карт (см. gateway.html).
// Шлюз живёт в скрытом iframe, создаётся только на время операции и удаляется после неё.

import { appUrl } from './style';

export type GatewayErrorCode = 'too-large' | 'aborted' | 'not-vector' | 'bad-url' | 'network' | 'timeout';

export class GatewayError extends Error {
  constructor(public code: GatewayErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface Progress {
  done: number;
  total: number;
  bytes: number;
  zoom: number;
}

export interface ProbeResult {
  host: string;
  name: string;
  header: { minZoom: number; maxZoom: number; bounds: [number, number, number, number]; tileType: number };
}

/** Сколько раз за сессию открывали сетевой шлюз и к каким хостам (для экрана «Приватность»). */
export const gatewayLog: { calls: number; hosts: Set<string> } = { calls: 0, hosts: new Set() };

function openGateway(): Promise<{ frame: HTMLIFrameElement }> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
    frame.setAttribute('aria-hidden', 'true');
    frame.title = 'map gateway';
    const timer = setTimeout(() => {
      frame.remove();
      reject(new GatewayError('network', 'gateway-timeout'));
    }, 10000);
    const onMsg = (e: MessageEvent) => {
      if (e.source === frame.contentWindow && e.data?.type === 'gateway-ready') {
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve({ frame });
      }
    };
    window.addEventListener('message', onMsg);
    frame.src = appUrl('gateway.html');
    document.body.appendChild(frame);
  });
}

function call<T>(payload: object, onProgress?: (p: Progress) => void, signal?: AbortSignal): Promise<T> {
  gatewayLog.calls++;
  return openGateway().then(
    ({ frame }) =>
      new Promise<T>((resolve, reject) => {
        const ch = new MessageChannel();
        const finish = () => {
          ch.port1.close();
          frame.remove();
        };
        signal?.addEventListener('abort', () => ch.port1.postMessage({ type: 'cancel' }));
        ch.port1.onmessage = (m) => {
          const d = m.data;
          if (d.type === 'progress') onProgress?.(d as Progress);
          else if (d.type === 'error') {
            finish();
            reject(new GatewayError(d.code, d.message));
          } else {
            if (d.host) gatewayLog.hosts.add(d.host);
            finish();
            resolve(d as T);
          }
        };
        frame.contentWindow!.postMessage(payload, '*', [ch.port2]);
      }),
  );
}

/** Проверка источника: читает только заголовок и метаданные (пара небольших Range-запросов). */
export function probeSource(url: string): Promise<ProbeResult> {
  return call<ProbeResult & { type: string }>({ type: 'probe', url });
}

export async function downloadRegion(opts: {
  url: string;
  bbox: [number, number, number, number];
  maxZoom: number;
  name: string;
  maxBytes: number;
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}): Promise<{ blob: Blob; tiles: number; bytes: number }> {
  const { onProgress, signal, ...payload } = opts;
  const d = await call<{ blob: Blob; tiles: number; bytes: number }>({ type: 'extract', ...payload }, onProgress, signal);
  return { blob: d.blob, tiles: d.tiles, bytes: d.bytes };
}
