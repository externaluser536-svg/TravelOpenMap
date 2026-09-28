#!/usr/bin/env node
/**
 * Идемпотентно настраивает нативные проекты Capacitor (android/, ios/) под TravelOpenMap:
 *  • Android: убирает разрешение INTERNET (приложение принципиально не ходит в сеть),
 *    добавляет геолокацию, камеру и микрофон (запись видео);
 *  • iOS: добавляет тексты запросов разрешений (геолокация, камера, микрофон, фото, датчики).
 *
 * Запускается автоматически из `npm run cap:sync`, и его безопасно запускать повторно.
 *   node scripts/configure-native.mjs [--keep-internet]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const keepInternet = process.argv.includes('--keep-internet');

// ---------------- Android ----------------
const manifest = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  const block = [
    '    <!-- Permissions (TravelOpenMap) -->',
    keepInternet
      ? '    <uses-permission android:name="android.permission.INTERNET" />'
      : '    <!-- INTERNET намеренно отсутствует: приложение работает полностью офлайн.\n         Для live-reload при разработке запустите: node scripts/configure-native.mjs --keep-internet -->',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '    <uses-permission android:name="android.permission.CAMERA" />',
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '    <uses-feature android:name="android.hardware.sensor.compass" android:required="false" />',
  ].join('\n');
  x = x.replace(/\s*<!-- Permissions[\s\S]*?(?=<\/manifest>)/, `\n\n${block}\n`);
  writeFileSync(manifest, x);
  console.log(`android: разрешения обновлены (INTERNET ${keepInternet ? 'оставлен' : 'удалён'})`);
}

// ---------------- iOS ----------------
const plist = join(ROOT, 'ios/App/App/Info.plist');
if (existsSync(plist)) {
  let x = readFileSync(plist, 'utf8');
  const keys = {
    NSLocationWhenInUseUsageDescription: 'Геолокация нужна, чтобы рассеивать туман там, где вы побывали, и привязывать заметки к месту. / Location is used to clear the fog where you have been and to pin notes.',
    NSCameraUsageDescription: 'Камера нужна, чтобы снимать фото и видео для заметок. / The camera is used to capture photos and videos for notes.',
    NSMicrophoneUsageDescription: 'Микрофон нужен для записи звука в видео. / The microphone records sound in videos.',
    NSPhotoLibraryUsageDescription: 'Доступ к галерее нужен, чтобы прикреплять фото и видео к заметкам. / Library access attaches photos and videos to notes.',
    NSMotionUsageDescription: 'Датчики движения нужны для работы компаса. / Motion sensors power the compass.',
  };
  for (const [k, v] of Object.entries(keys)) {
    if (x.includes(`<key>${k}</key>`)) continue;
    x = x.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>${k}</key>\n\t<string>${v}</string>\n</dict>\n</plist>\n`);
  }
  writeFileSync(plist, x);
  console.log('ios: тексты разрешений добавлены');
}
