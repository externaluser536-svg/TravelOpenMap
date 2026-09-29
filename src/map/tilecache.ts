// Кэш тайлов в IndexedDB: карта, которую вы уже видели, работает без сети.
// Обычные тайлы вытесняются по давности использования (LRU) при превышении лимита;
// тайлы сохранённых для офлайна областей «закреплены» и не вытесняются.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface TileRecord {
  /** ключ: слой/z/x/y, например omt/12/2200/1345 */
  k: string;
  d: ArrayBuffer;
  /** последнее использование, мс */
  t: number;
  /** размер, байт */
  s: number;
  /** 1 — закреплён (сохранённая область) */
  p: 0 | 1;
}

interface TileDB extends DBSchema {
  tiles: { key: string; value: TileRecord; indexes: { t: number } };
  meta: { key: string; value: { k: string; v: number } };
}

export interface CacheStats {
  count: number;
  bytes: number;
  pinnedBytes: number;
}

const TOUCH_AFTER_MS = 24 * 3600 * 1000;

export class TileCache {
  private dbp: Promise<IDBPDatabase<TileDB>> | null = null;
  private limit: number;
  /** учёт размера ведём в памяти и периодически сохраняем: перечитывать весь кэш на каждую запись слишком дорого */
  private total: { bytes: number; pinned: number; count: number } | null = null;
  private evicting = false;

  constructor(
    private name = 'tom-tiles',
    limitBytes = 500 * 1024 * 1024,
  ) {
    this.limit = limitBytes;
  }

  private db(): Promise<IDBPDatabase<TileDB>> {
    if (!this.dbp) {
      this.dbp = openDB<TileDB>(this.name, 1, {
        upgrade(db) {
          db.createObjectStore('tiles', { keyPath: 'k' }).createIndex('t', 't');
          db.createObjectStore('meta', { keyPath: 'k' });
        },
      });
    }
    return this.dbp;
  }

  setLimit(bytes: number): void {
    this.limit = bytes;
  }

  private async totals(): Promise<{ bytes: number; pinned: number; count: number }> {
    if (this.total) return this.total;
    const db = await this.db();
    let bytes = 0;
    let pinned = 0;
    let count = 0;
    let cur = await db.transaction('tiles').store.openCursor();
    while (cur) {
      bytes += cur.value.s;
      if (cur.value.p) pinned += cur.value.s;
      count++;
      cur = await cur.continue();
    }
    this.total = { bytes, pinned, count };
    return this.total;
  }

  async get(key: string): Promise<ArrayBuffer | undefined> {
    const db = await this.db();
    const rec = await db.get('tiles', key);
    if (!rec) return undefined;
    if (Date.now() - rec.t > TOUCH_AFTER_MS) void db.put('tiles', { ...rec, t: Date.now() }).catch(() => {});
    return rec.d;
  }

  async has(key: string): Promise<boolean> {
    return (await (await this.db()).getKey('tiles', key)) !== undefined;
  }

  async put(key: string, data: ArrayBuffer, pinned = false): Promise<void> {
    const db = await this.db();
    const tot = await this.totals();
    const prev = await db.get('tiles', key);
    const rec: TileRecord = { k: key, d: data, t: Date.now(), s: data.byteLength, p: pinned || prev?.p ? 1 : 0 };
    await db.put('tiles', rec);
    if (prev) {
      tot.bytes -= prev.s;
      if (prev.p) tot.pinned -= prev.s;
    } else tot.count++;
    tot.bytes += rec.s;
    if (rec.p) tot.pinned += rec.s;
    if (tot.bytes - tot.pinned > this.limit) void this.evict();
  }

  /** Закрепляет уже лежащий в кэше тайл (при сохранении области, если тайл был просмотрен раньше). */
  async pin(key: string): Promise<boolean> {
    const db = await this.db();
    const rec = await db.get('tiles', key);
    if (!rec) return false;
    if (!rec.p) {
      await db.put('tiles', { ...rec, p: 1 });
      const tot = await this.totals();
      tot.pinned += rec.s;
    }
    return true;
  }

  /** Удаляет самые давние незакреплённые тайлы, пока кэш не уложится в 90 % лимита. */
  async evict(): Promise<number> {
    if (this.evicting) return 0;
    this.evicting = true;
    try {
      const db = await this.db();
      const tot = await this.totals();
      const target = this.limit * 0.9;
      let removed = 0;
      let cur = await db.transaction('tiles', 'readwrite').store.index('t').openCursor();
      while (cur && tot.bytes - tot.pinned > target) {
        const v = cur.value;
        if (!v.p) {
          await cur.delete();
          tot.bytes -= v.s;
          tot.count--;
          removed++;
        }
        cur = await cur.continue();
      }
      return removed;
    } finally {
      this.evicting = false;
    }
  }

  async stats(): Promise<CacheStats> {
    const t = await this.totals();
    return { count: t.count, bytes: t.bytes, pinnedBytes: t.pinned };
  }

  /** Полностью очищает кэш (включая закреплённые области). */
  async clear(): Promise<void> {
    await (await this.db()).clear('tiles');
    this.total = { bytes: 0, pinned: 0, count: 0 };
  }

  /** Снимает закрепление с тайлов (при удалении сохранённой области): они станут обычными и со временем вытеснятся. */
  async unpinKeys(keys: Iterable<string>): Promise<void> {
    const db = await this.db();
    const tx = db.transaction('tiles', 'readwrite');
    for (const k of keys) {
      const rec = await tx.store.get(k);
      if (rec?.p) await tx.store.put({ ...rec, p: 0 });
    }
    await tx.done;
    this.total = null;
    void this.evict();
  }
}

/** Общий кэш приложения. */
export const tileCache = new TileCache();
