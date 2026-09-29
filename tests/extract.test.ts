import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Compression, PMTiles, TileType, zxyToTileId, type Source } from 'pmtiles';
import { writePmtiles } from '../src/map/pmtiles-writer';
import { ExtractTooLargeError, countTiles, estimateBytes, extractRegion, tileRange } from '../src/map/extract';

function memSource(buf: Uint8Array, key = 'mem'): Source {
  return {
    getKey: () => key,
    getBytes: async (offset: number, length: number) => ({ data: buf.slice(offset, offset + length).buffer as ArrayBuffer }),
  };
}

const monaco = new Uint8Array(readFileSync('public/maps/monaco.pmtiles'));
const MONACO_BBOX: [number, number, number, number] = [7.349, 43.71, 7.491, 43.77];

describe('PMTiles: писатель', () => {
  it('собирает файл, который читает штатный ридер (дедупликация и run-length)', async () => {
    const tile = new Uint8Array([1, 2, 3, 4, 5]);
    const other = new Uint8Array([9, 9]);
    const tiles = [
      { z: 2, x: 0, y: 0, data: tile },
      { z: 2, x: 1, y: 0, data: tile },
      { z: 2, x: 2, y: 0, data: tile },
      { z: 2, x: 3, y: 3, data: other },
      { z: 0, x: 0, y: 0, data: other },
    ];
    const blob = await writePmtiles(tiles, { tileType: TileType.Mvt, tileCompression: Compression.None, minZoom: 0, maxZoom: 2, bounds: [-10, -20, 30, 40] }, { name: 'тест' });
    const p = new PMTiles(memSource(new Uint8Array(await blob.arrayBuffer())));
    const h = await p.getHeader();
    expect(h.minZoom).toBe(0);
    expect(h.maxZoom).toBe(2);
    expect(h.minLon).toBeCloseTo(-10, 5);
    expect(h.maxLat).toBeCloseTo(40, 5);
    expect(h.numAddressedTiles).toBe(5);
    expect(h.numTileContents).toBeLessThan(5); // «tile» ×3 подряд склеены в один
    expect(((await p.getMetadata()) as { name: string }).name).toBe('тест');
    expect([...new Uint8Array((await p.getZxy(2, 1, 0))!.data)]).toEqual([...tile]);
    expect([...new Uint8Array((await p.getZxy(2, 3, 3))!.data)]).toEqual([...other]);
    expect(await p.getZxy(2, 3, 0)).toBeUndefined();
  });

  it('большой набор → листовые каталоги, все тайлы читаются', async () => {
    const tiles = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const seen = new Set<number>();
    while (tiles.length < 30000) {
      const x = Math.floor(rnd() * 4096);
      const y = Math.floor(rnd() * 4096);
      if (seen.has(x * 4096 + y)) continue;
      seen.add(x * 4096 + y);
      tiles.push({ z: 12, x, y, data: new Uint8Array([x & 255, x >> 8, y & 255, y >> 8, (x * 31 + y) & 255]) });
    }
    const blob = await writePmtiles(tiles, { tileType: TileType.Mvt, tileCompression: Compression.None, minZoom: 12, maxZoom: 12, bounds: [-180, -85, 180, 85] }, {});
    const p = new PMTiles(memSource(new Uint8Array(await blob.arrayBuffer())));
    const h = await p.getHeader();
    expect(h.leafDirectoryLength ?? 0).toBeGreaterThan(0);
    for (const t of [tiles[0], tiles[15000], tiles[29999], tiles[777]]) {
      expect([...new Uint8Array((await p.getZxy(12, ((t.data[1] << 8) | t.data[0]), ((t.data[3] << 8) | t.data[2])))!.data)]).toEqual([...t.data]);
    }
    expect(zxyToTileId(7, 0, 0)).toBeGreaterThan(0);
  });
});

describe('извлечение региона', () => {
  it('математика тайлов', () => {
    const r = tileRange(MONACO_BBOX, 14);
    expect(r.x1 - r.x0 + 1).toBeGreaterThanOrEqual(2);
    expect(countTiles(MONACO_BBOX, 0, 2)).toBe(3);
    expect(estimateBytes(MONACO_BBOX, 0, 10)).toBeGreaterThan(1000);
    expect(estimateBytes(MONACO_BBOX, 0, 14)).toBeGreaterThan(estimateBytes(MONACO_BBOX, 0, 10));
  });

  it('вырезает Монако из monaco.pmtiles: те же байты тайлов, меньше уровней', async () => {
    const src = new PMTiles(memSource(monaco, 'src'));
    const progress: number[] = [];
    // рамка — центральная часть, уровни до z13
    const bbox: [number, number, number, number] = [7.40, 43.72, 7.45, 43.75];
    const out = await extractRegion(src, { bbox, maxZoom: 13, name: 'Монако (центр)', onProgress: (p) => progress.push(p.done) });
    expect(out.tiles).toBeGreaterThan(10);
    const p = new PMTiles(memSource(new Uint8Array(await out.blob.arrayBuffer()), 'out'));
    const h = await p.getHeader();
    expect(h.maxZoom).toBe(13);
    expect(h.tileType).toBe(TileType.Mvt);
    expect(h.numAddressedTiles).toBe(out.tiles);
    expect(((await p.getMetadata()) as { name: string }).name).toBe('Монако (центр)');
    // байты тайла совпадают с оригиналом
    const r = tileRange(bbox, 13);
    const a = await src.getZxy(13, r.x0, r.y0);
    const b = await p.getZxy(13, r.x0, r.y0);
    expect(a).toBeDefined();
    expect([...new Uint8Array(b!.data)]).toEqual([...new Uint8Array(a!.data)]);
    // уровня 14 в результате нет
    expect(await p.getZxy(14, tileRange(bbox, 14).x0, tileRange(bbox, 14).y0)).toBeUndefined();
    expect(progress.length).toBeGreaterThan(0);
    // результат меньше исходника
    expect(out.blob.size).toBeLessThan(monaco.length);
  });

  it('лимит размера и отмена', async () => {
    const src = new PMTiles(memSource(monaco, 'src2'));
    await expect(extractRegion(src, { bbox: MONACO_BBOX, maxZoom: 15, name: 'x', maxBytes: 5000 })).rejects.toBeInstanceOf(ExtractTooLargeError);
    const ac = new AbortController();
    ac.abort();
    await expect(extractRegion(src, { bbox: MONACO_BBOX, maxZoom: 15, name: 'x', signal: ac.signal })).rejects.toThrow();
  });
});
