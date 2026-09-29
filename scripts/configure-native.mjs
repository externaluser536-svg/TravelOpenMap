#!/usr/bin/env node
/**
 * Идемпотентно настраивает нативные проекты Capacitor (android/, ios/) под TravelOpenMap:
 *  • Android: добавляет службу фоновой записи и её разрешения; добавляет INTERNET (нужно только для необязательной, выключенной по умолчанию загрузки карт стран —
 *    основное приложение не делает сетевых запросов, это гарантирует его CSP); флаг --offline-only
 *    убирает INTERNET совсем — тогда ОС сама гарантирует отсутствие сети, а карты добавляются только импортом файлом;
 *    добавляет геолокацию, камеру и микрофон (запись видео);
 *  • iOS: добавляет тексты запросов разрешений (геолокация, камера, микрофон, фото, датчики).
 *
 * Запускается автоматически из `npm run cap:sync`, и его безопасно запускать повторно.
 *   node scripts/configure-native.mjs [--offline-only]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const offlineOnly = process.argv.includes('--offline-only');
const keepInternet = !offlineOnly;

// ---------------- Android ----------------
const manifest = join(ROOT, 'android/app/src/main/AndroidManifest.xml');
if (existsSync(manifest)) {
  let x = readFileSync(manifest, 'utf8');
  const block = [
    '    <!-- Permissions (TravelOpenMap) -->',
    keepInternet
      ? '    <!-- INTERNET нужен только для необязательной загрузки карт стран (по умолчанию выключена, CSP запрещает всё остальное). Строгая сборка: флаг offline-only в scripts/configure-native.mjs -->\n    <uses-permission android:name="android.permission.INTERNET" />'
      : '    <!-- INTERNET намеренно отсутствует (сборка offline-only): приложение работает полностью офлайн, загрузка карт стран недоступна. -->',
    '    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
    '    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '    <!-- Фоновая запись трека: служба переднего плана с типом location (без сервисов Google Play) -->',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
    '    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />',
    '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    '    <uses-permission android:name="android.permission.CAMERA" />',
    '    <uses-permission android:name="android.permission.RECORD_AUDIO" />',
    '    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
    '    <uses-feature android:name="android.hardware.location.gps" android:required="false" />',
    '    <uses-feature android:name="android.hardware.camera" android:required="false" />',
    '    <uses-feature android:name="android.hardware.sensor.compass" android:required="false" />',
  ].join('\n');
  x = x.replace(/\s*<!-- Permissions[\s\S]*?(?=<\/manifest>)/, `\n\n${block}\n`);
  // служба фоновой записи — внутри <application>
  if (!x.includes('.TrackingService')) {
    x = x.replace(
      '    </application>',
      '        <!-- Фоновая запись трека -->\n        <service\n            android:name=".TrackingService"\n            android:exported="false"\n            android:foregroundServiceType="location" />\n    </application>',
    );
  }
  writeFileSync(manifest, x);
  console.log(`android: разрешения обновлены (INTERNET ${keepInternet ? 'добавлен — для необязательной загрузки карт' : 'удалён — сборка offline-only'})`);
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
