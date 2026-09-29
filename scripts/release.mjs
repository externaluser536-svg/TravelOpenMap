#!/usr/bin/env node
/**
 * Release-сборки. Результат — папка release/ (APK, AAB, веб-архив, SHA256SUMS.txt).
 *
 *   node scripts/release.mjs [--web] [--android] [--test-key] [--no-build]
 *
 *   --web        веб-версия: dist/ → TravelOpenMap-<версия>-web.zip
 *   --android    подписанный (если есть ключ) release APK и AAB (нужны JDK 21 и Android SDK)
 *   --test-key   подписать публичным тестовым ключом android/keystore/tom-test.jks (только для тестовых сборок)
 *   --no-build   не пересобирать веб-часть (использовать готовый dist/)
 *
 * Без флагов --web/--android собирается всё, что возможно в этой среде.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'release');
const args = new Set(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const testKey = args.has('--test-key');
const suffix = testKey ? `${pkg.version}-test` : pkg.version;
const wantAll = !args.has('--web') && !args.has('--android');
const built = [];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

if (wantAll || args.has('--web')) {
  if (!args.has('--no-build')) await run('npm', ['run', 'build'], { cwd: ROOT });
  const zip = join(OUT, `TravelOpenMap-${suffix}-web.zip`);
  await run('zip', ['-qr', zip, '.'], { cwd: join(ROOT, 'dist') });
  built.push(zip);
}

if (wantAll || args.has('--android')) {
  const hasSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || existsSync(join(ROOT, 'android', 'local.properties'));
  if (!hasSdk) {
    if (args.has('--android')) throw new Error('Не найден Android SDK: задайте ANDROID_HOME или android/local.properties (sdk.dir=…)');
    console.warn('⚠️  Android SDK не найден — Android-сборка пропущена (см. INSTALLATION.md).');
  } else {
    if (!args.has('--no-build')) await run('npm', ['run', 'cap:sync'], { cwd: ROOT });
    const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    await run(gradle, ['assembleRelease', 'bundleRelease', ...(testKey ? ['-PtestKeystore'] : [])], { cwd: join(ROOT, 'android') });
    const outputs = join(ROOT, 'android', 'app', 'build', 'outputs');
    const pick = (dir, ext) => {
      const d = join(outputs, dir, 'release');
      return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(ext)) : [];
    };
    for (const f of pick('apk', '.apk')) {
      const to = join(OUT, `TravelOpenMap-${suffix}-${f.includes('unsigned') ? 'unsigned' : 'release'}.apk`);
      copyFileSync(join(outputs, 'apk', 'release', f), to);
      built.push(to);
    }
    for (const f of pick('bundle', '.aab')) {
      const to = join(OUT, `TravelOpenMap-${suffix}-release.aab`);
      copyFileSync(join(outputs, 'bundle', 'release', f), to);
      built.push(to);
    }
  }
}

const sums = built.map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${f.split(/[\\/]/).pop()}`);
writeFileSync(join(OUT, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`\nRelease ${suffix}:`);
for (const f of built) console.log(`  ${(statSync(f).size / 1e6).toFixed(1).padStart(6)} МБ  ${f}`);
