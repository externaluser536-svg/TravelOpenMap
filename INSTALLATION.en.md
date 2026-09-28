# 🛠️ Installation, running and building

*[Русская версия → INSTALLATION.md](INSTALLATION.md)*

## 1. Requirements

* **Node.js ≥ 20** (tested on 22) + npm
* Android: **JDK 17+**, **Android Studio** with Android SDK 36, emulator or device
* iOS: **macOS**, **Xcode 15+**, **CocoaPods**, Apple Developer account for devices
* Custom maps from `.osm.pbf`: **Python ≥ 3.10**
* Screenshots / e2e: `npx playwright install chromium`

## 2. Run in the browser

```bash
git clone https://github.com/externaluser536-svg/TravelOpenMap.git && cd TravelOpenMap
git checkout claude/dreamy-gauss-2mrns2
npm install
npm run dev            # http://localhost:5173  — add ?demo to load demo data
npm run build && npm run preview
```

Browser geolocation works on `localhost` (use DevTools → Sensors to fake it). Camera/video buttons open a file picker (the camera on phones). The compass needs a real device sensor.

## 3. Tests

```bash
npm run typecheck && npm test        # 40 unit tests
npm run test:e2e                     # production build, DNS for external hosts disabled, zero-request check
```

## 4. Android

```bash
npm run cap:sync        # web build → cap sync → permissions (scripts/configure-native.mjs)
npm run android         # opens Android Studio → Run ▶
npm run android:apk     # debug APK: android/app/build/outputs/apk/debug/app-debug.apk (needs ANDROID_HOME)
```

Release: create a keystore (`keytool -genkey -v -keystore travelopenmap.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tom`), then *Build → Generate Signed Bundle / APK*. Keep keys out of the repo. App id: `app.travelopenmap` (`capacitor.config.ts`).

`INTERNET` is intentionally **removed** from the manifest. For live reload use `node scripts/configure-native.mjs --keep-internet`, and re-run `npm run cap:sync` before releasing.

## 5. iOS (macOS only)

```bash
npm run cap:sync && (cd ios/App && pod install)
npm run ios             # opens Xcode → select Team under Signing & Capabilities → Run ▶
```

Permission strings (location, camera, microphone, photos, motion) are added to `Info.plist` by the configure script.

## 6. Offline maps

The Monaco demo (`public/maps/monaco.pmtiles`) is bundled. Add your own via *Profile → Offline maps → Import .pmtiles*, or drop the file into `public/maps/` and register it in `public/maps/manifest.json`. To produce a file:

```bash
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles paris.pmtiles --bbox=2.22,48.81,2.47,48.91 --maxzoom=15
# or, fully local:
tools/build-demo-map.sh region.osm.pbf "My region" region
```

See [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md). Map fonts/sprites: `npm run assets:fonts` (one-time download).

## 7. Screenshots & icons

`npm run screenshots` · `npm run icons`

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| Blank map | The file is missing or doesn't cover your location: check `manifest.json`, *Offline maps*, the “No offline map here” banner. |
| Blank screen on Android without INTERNET | Untested on device. Restore it with `--keep-internet` (CSP still blocks external connections) and open an issue. |
| Fog not clearing | Location permission; *Settings → GPS accuracy*; you may be inside an excluded zone. |
| Compass silent | iOS needs a tap on “Allow” in the Compass sheet; emulators have no sensor. |
| Tiles fail from the bundled file on iOS | `capacitor://` scheme + HTTP Range; import the map via the app instead (read as a `File`, no HTTP). |
| `SDK location not found` | Set `ANDROID_HOME` or `android/local.properties` (`sdk.dir=…`). |
