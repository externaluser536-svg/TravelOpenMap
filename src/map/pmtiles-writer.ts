// Минимальный писатель PMTiles v3 (без внешних зависимостей).
// Формат: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
//
// Заголовок 127 байт → корневой каталог → метаданные → листовые каталоги → данные тайлов.
// Каталоги: varint-дельты + gzip. Одинаковые подряд идущие тайлы (море, пустая суша)
// хранятся один раз и склеиваются в run-length.

import { Compression, TileType, zxyToTileId } from 'pmtiles';

export interface WriterTile {
  z: number;
  x: number;
  y: number;
  /** байты тайла в том виде, как должны лежать в файле (обычно gzip-MVT) */
  data: Uint8Array;
}

export interface WriterHeader {
  tileType: TileType;
  tileCompression: Compression;
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number]; // west, south, east, north
  centerZoom?: number;
  center?: [number, number];
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  void w.write(data as BufferSource);
  void w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

function varint(out: number[], v: number): void {
  // значения до 2^53: делим арифметически (побитовые операции JS — 32-битные)
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

interface Entry {
  tileId: number;
  offset: number;
  length: number;
  runLength: number;
}

async function serializeDirectory(entries: Entry[]): Promise<Uint8Array> {
  const b: number[] = [];
  varint(b, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(b, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(b, e.runLength);
  for (const e of entries) varint(b, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) varint(b, 0);
    else varint(b, e.offset + 1);
  }
  return gzip(Uint8Array.from(b));
}

function fnv(data: Uint8Array): number {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function writeU64(dv: DataView, pos: number, v: number): void {
  dv.setUint32(pos, v % 0x100000000, true);
  dv.setUint32(pos + 4, Math.floor(v / 0x100000000), true);
}

function buildHeader(h: {
  root: [number, number];
  meta: [number, number];
  leaf: [number, number];
  data: [number, number];
  addressed: number;
  entries: number;
  contents: number;
  head: WriterHeader;
}): Uint8Array {
  const buf = new ArrayBuffer(127);
  const dv = new DataView(buf);
  new Uint8Array(buf).set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]); // "PMTiles" + версия 3
  const fields = [...h.root, ...h.meta, ...h.leaf, ...h.data, h.addressed, h.entries, h.contents];
  fields.forEach((v, i) => writeU64(dv, 8 + i * 8, v));
  dv.setUint8(96, 1); // clustered
  dv.setUint8(97, Compression.Gzip); // internal
  dv.setUint8(98, h.head.tileCompression);
  dv.setUint8(99, h.head.tileType);
  dv.setUint8(100, h.head.minZoom);
  dv.setUint8(101, h.head.maxZoom);
  const e7 = (v: number) => Math.round(v * 1e7);
  const [w, s, e, n] = h.head.bounds;
  dv.setInt32(102, e7(w), true);
  dv.setInt32(106, e7(s), true);
  dv.setInt32(110, e7(e), true);
  dv.setInt32(114, e7(n), true);
  dv.setUint8(118, h.head.centerZoom ?? Math.min(h.head.maxZoom, Math.max(h.head.minZoom, 10)));
  const c = h.head.center ?? [(w + e) / 2, (s + n) / 2];
  dv.setInt32(119, e7(c[0]), true);
  dv.setInt32(123, e7(c[1]), true);
  return new Uint8Array(buf);
}

/** Собирает PMTiles-файл (Blob) из набора тайлов. Память: сами тайлы (без копий) + служебные каталоги. */
export async function writePmtiles(tiles: WriterTile[], head: WriterHeader, metadata: Record<string, unknown>): Promise<Blob> {
  const sorted = tiles.map((t) => ({ id: zxyToTileId(t.z, t.x, t.y), data: t.data })).sort((a, b) => a.id - b.id);

  // 1) данные с дедупликацией подряд идущих одинаковых тайлов
  const dataParts: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;
  let lastHash = -1;
  let lastData: Uint8Array | null = null;
  let contents = 0;
  for (const t of sorted) {
    const h = fnv(t.data);
    const prev = entries[entries.length - 1];
    if (
      prev &&
      lastData &&
      h === lastHash &&
      t.id === prev.tileId + prev.runLength &&
      t.data.length === lastData.length &&
      t.data.every((v, i) => v === lastData![i])
    ) {
      prev.runLength++;
      continue;
    }
    entries.push({ tileId: t.id, offset, length: t.data.length, runLength: 1 });
    dataParts.push(t.data);
    offset += t.data.length;
    lastHash = h;
    lastData = t.data;
    contents++;
  }
  const dataLength = offset;

  // 2) каталоги: корень ≤ 16 КБ вместе с заголовком, иначе — листовые каталоги
  let rootDir = await serializeDirectory(entries);
  let leafBytes: Uint8Array[] = [];
  let leafLength = 0;
  if (rootDir.length > 16384 - 127) {
    let leafSize = 4096;
    for (;;) {
      leafBytes = [];
      const rootEntries: Entry[] = [];
      let off = 0;
      for (let i = 0; i < entries.length; i += leafSize) {
        const chunk = entries.slice(i, i + leafSize);
        const bytes = await serializeDirectory(chunk);
        rootEntries.push({ tileId: chunk[0].tileId, offset: off, length: bytes.length, runLength: 0 });
        leafBytes.push(bytes);
        off += bytes.length;
      }
      leafLength = off;
      rootDir = await serializeDirectory(rootEntries);
      if (rootDir.length <= 16384 - 127) break;
      leafSize *= 2;
    }
  }

  const meta = await gzip(new TextEncoder().encode(JSON.stringify(metadata)));
  const rootOffset = 127;
  const metaOffset = rootOffset + rootDir.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + leafLength;
  const header = buildHeader({
    root: [rootOffset, rootDir.length],
    meta: [metaOffset, meta.length],
    leaf: [leafOffset, leafLength],
    data: [dataOffset, dataLength],
    addressed: sorted.length,
    entries: entries.length,
    contents,
    head,
  });
  return new Blob([header as BlobPart, rootDir as BlobPart, meta as BlobPart, ...(leafBytes as BlobPart[]), ...(dataParts as BlobPart[])], { type: 'application/octet-stream' });
}
