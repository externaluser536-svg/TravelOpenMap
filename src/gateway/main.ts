// Код шлюза загрузки карт (работает внутри скрытого iframe, см. gateway.html).
// Протокол: родитель шлёт сообщение с MessagePort; шлюз отвечает по этому порту.

import { PMTiles } from 'pmtiles';
import { extractRegion, ExtractTooLargeError } from '../map/extract';

type Req =
  | { type: 'probe'; url: string }
  | { type: 'extract'; url: string; bbox: [number, number, number, number]; maxZoom: number; name: string; maxBytes: number };

function validUrl(u: string): URL {
  const url = new URL(u);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('bad-url');
  return url;
}

window.addEventListener('message', (ev: MessageEvent) => {
  const port = ev.ports[0];
  if (!port || ev.source !== window.parent) return;
  const req = ev.data as Req;
  const ac = new AbortController();
  port.onmessage = (m) => {
    if (m.data?.type === 'cancel') ac.abort();
  };
  void (async () => {
    try {
      const url = validUrl(req.url);
      const src = new PMTiles(url.href);
      if (req.type === 'probe') {
        const h = await src.getHeader();
        const meta = (await src.getMetadata()) as Record<string, unknown>;
        port.postMessage({
          type: 'probed',
          host: url.host,
          header: { minZoom: h.minZoom, maxZoom: h.maxZoom, bounds: [h.minLon, h.minLat, h.maxLon, h.maxLat], tileType: h.tileType },
          name: String(meta?.name ?? ''),
        });
        return;
      }
      const out = await extractRegion(src, {
        bbox: req.bbox,
        maxZoom: req.maxZoom,
        name: req.name,
        maxBytes: req.maxBytes,
        signal: ac.signal,
        onProgress: (p) => port.postMessage({ type: 'progress', ...p }),
      });
      port.postMessage({ type: 'done', blob: out.blob, tiles: out.tiles, bytes: out.bytes, host: url.host });
    } catch (e) {
      const err = e as Error;
      port.postMessage({
        type: 'error',
        code: e instanceof ExtractTooLargeError ? 'too-large' : err.name === 'AbortError' ? 'aborted' : err.message === 'not-vector' ? 'not-vector' : err.message === 'bad-url' ? 'bad-url' : 'network',
        message: err.message,
      });
    }
  })();
});

window.parent.postMessage({ type: 'gateway-ready' }, '*');
