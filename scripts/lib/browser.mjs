// Общий запуск Chromium для скриптов (скриншоты, проверка офлайн-режима).
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function findChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) {
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const d of dirs) {
      const p = join(root, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined; // стандартный браузер Playwright (npx playwright install chromium)
}

export async function launch() {
  return chromium.launch({
    executablePath: findChromium(),
    args: [
      '--use-angle=swiftshader',
      '--use-gl=angle',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}
