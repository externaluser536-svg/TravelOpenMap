// Подмена серверов онлайн-карты для проверок и скриншотов без выхода в интернет:
//  • OpenFreeMap отвечает крошечным набором тайлов схемы OpenMapTiles (scripts/mock/gen-omt.py);
//  • рельеф AWS Terrain — настоящие тайлы, если они доступны из этой среды (кэшируются на диск), иначе 404.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MOCK_DIR = join(tmpdir(), 'tom-mock-omt');
const DEM_DIR = join(tmpdir(), 'tom-dem-cache');
const CORS = { 'access-control-allow-origin': '*' };
export const ALLOWED_HOSTS = ['tiles.openfreemap.org', 'elevation-tiles-prod.s3.amazonaws.com'];

export function ensureMockTiles() {
  mkdirSync(DEM_DIR, { recursive: true });
  if (!existsSync(join(MOCK_DIR, '0'))) execFileSync('python3', [join(ROOT, 'scripts/mock/gen-omt.py'), MOCK_DIR], { stdio: 'inherit' });
}

/** Вешает подмену на контекст браузера. Возвращает счётчики запросов. */
export async function mockOnline(ctx) {
  ensureMockTiles();
  const state = { omt: 0, dem: 0, demOk: true };
  await ctx.route('https://tiles.openfreemap.org/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/planet') {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ tiles: ['https://tiles.openfreemap.org/planet/mock/{z}/{x}/{y}.pbf'] }) });
    }
    const m = /\/mock\/(\d+)\/(\d+)\/(\d+)\.pbf$/.exec(u.pathname);
    const f = m && join(MOCK_DIR, m[1], m[2], `${m[3]}.pbf`);
    state.omt++;
    if (f && existsSync(f)) return route.fulfill({ status: 200, contentType: 'application/x-protobuf', headers: CORS, body: readFileSync(f) });
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
  await ctx.route('https://elevation-tiles-prod.s3.amazonaws.com/**', async (route) => {
    const url = route.request().url();
    const f = join(DEM_DIR, url.split('/terrarium/')[1].replace(/\//g, '_'));
    if (!existsSync(f)) {
      try {
        writeFileSync(f, execFileSync('curl', ['-s', '--max-time', '25', '-f', url], { maxBuffer: 20e6 }));
      } catch {
        state.demOk = false;
        return route.fulfill({ status: 404, headers: CORS, body: '' });
      }
    }
    state.dem++;
    return route.fulfill({ status: 200, contentType: 'image/png', headers: CORS, body: readFileSync(f) });
  });
  return state;
}
