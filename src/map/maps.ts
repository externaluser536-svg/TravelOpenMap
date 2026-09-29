// Каталог офлайн-карт: встроенные в приложение (public/maps/manifest.json) и
// импортированные пользователем (хранятся в IndexedDB).

import { deleteMapRecord, listMaps, putMap, uid, type OfflineMapRecord } from '../data/db';
import { forgetMap, inspectPmtiles, openBlobMap, openBundledMap, type MapInfo } from './pmtiles';
import { appUrl } from './style';

export interface CatalogEntry {
  id: string;
  name: string;
  source: 'bundled' | 'imported';
  size?: number;
  bounds?: [number, number, number, number];
  minzoom?: number;
  maxzoom?: number;
  country?: string;
}

interface Manifest {
  maps: { id: string; name: string; file: string }[];
}

async function readManifest(): Promise<Manifest> {
  try {
    const res = await fetch(appUrl('maps/manifest.json'));
    if (res.ok) return (await res.json()) as Manifest;
  } catch {
    /* нет манифеста — нет встроенных карт */
  }
  return { maps: [] };
}

export async function loadCatalog(): Promise<CatalogEntry[]> {
  const manifest = await readManifest();
  const bundled: CatalogEntry[] = [];
  for (const m of manifest.maps) {
    try {
      const info = await openBundledMap(m.id, m.name, m.file);
      bundled.push({ id: m.id, name: m.name, source: 'bundled', bounds: info.bounds, minzoom: info.minzoom, maxzoom: info.maxzoom });
    } catch {
      /* файл отсутствует */
    }
  }
  const imported = (await listMaps()).map<CatalogEntry>((r) => ({
    id: r.id,
    name: r.name,
    source: 'imported',
    size: r.size,
    bounds: r.bounds,
    minzoom: r.minzoom,
    maxzoom: r.maxzoom,
    country: r.country,
  }));
  return [...bundled, ...imported];
}

export async function openMap(id: string): Promise<MapInfo | null> {
  const manifest = await readManifest();
  const b = manifest.maps.find((m) => m.id === id);
  if (b) return openBundledMap(b.id, b.name, b.file);
  const rec = (await listMaps()).find((r) => r.id === id);
  if (rec) return openBlobMap(rec.id, rec.name, rec.blob);
  return null;
}

/** Импорт файла .pmtiles. Бросает Error с понятным текстом, если файл не подходит. */
export async function importMapFile(file: File, extra: { name?: string; country?: string } = {}): Promise<OfflineMapRecord> {
  const info = await inspectPmtiles(file);
  if (!info.vector) throw new Error('not-vector');
  const rec: OfflineMapRecord = {
    id: `imported:${uid()}`,
    name: extra.name ?? file.name.replace(/\.pmtiles$/i, ''),
    country: extra.country,
    blob: file,
    size: file.size,
    bounds: info.bounds,
    minzoom: info.minzoom,
    maxzoom: info.maxzoom,
    addedAt: Date.now(),
  };
  await putMap(rec);
  return rec;
}

export async function removeMap(id: string): Promise<void> {
  forgetMap(id);
  await deleteMapRecord(id);
}
