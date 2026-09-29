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
npm run typecheck && npm test        # unit tests
npm run test:e2e                     # production build, DNS for external hosts disabled: zero-request check, fog brush, tutorial, and the online mode on mocked servers (npm run test:online)
```

## 4. Android

```bash
npm run cap:sync        # web build → cap sync → permissions (scripts/configure-native.mjs)
npm run android         # opens Android Studio → Run ▶
npm run android:apk     # debug APK: android/app/build/outputs/apk/debug/app-debug.apk (needs ANDROID_HOME)
```

Release: create a keystore (`keytool -genkey -v -keystore travelopenmap.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tom`), then *Build → Generate Signed Bundle / APK*. Keep keys out of the repo. App id: `app.travelopenmap` (`capacitor.config.ts`).

### Release build (test version)

```bash
npm run release:test        # APK signed with the test key + AAB + web archive → release/
npm run release:web         # web only (zip of dist/)
npm run release:android     # Android signed with your key; unsigned APK if none
```

Output goes to `release/`: `TravelOpenMap-<version>-test-release.apk`, `…-release.aab`, `…-web.zip`, `SHA256SUMS.txt`. The version comes from `package.json` (`0.4.0` → versionName `0.4.0`, versionCode `400`).

* **Test key.** `android/keystore/tom-test.jks` is in the repo with public passwords (`android/keystore/test.properties`) so test APKs can be installed over each other. **Never use it for Google Play or public releases.**
* **Your key.** `keytool -genkeypair -v -keystore my.jks -alias tom -keyalg RSA -keysize 2048 -validity 10000`, then create `android/keystore.properties` (git-ignored) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, or set `TOM_KEYSTORE_FILE`, `TOM_KEYSTORE_PASSWORD`, `TOM_KEY_ALIAS`, `TOM_KEY_PASSWORD`; then `npm run release:android`.
* **Requirements:** JDK 21, Android SDK (`ANDROID_HOME`), access to Google Maven and Maven Central.
* **GitHub Actions.** [`.github/workflows/release-test.yml`](.github/workflows/release-test.yml) builds the same on GitHub (push to `claude/**`, `v*` tags, or manually) and publishes a **pre-release** with the APK, AAB, web archive and checksums.
* iOS releases need macOS and Xcode (*Product → Archive*) with your Apple account; there is no test iOS build.

### Running without Google Play Services

The app uses no Google Maps, Firebase or other Google services. Location: the native plugin is called with `enableLocationFallback: true` (falls back to the system `LocationManager` when Play Services are missing); if it errors for a reason other than denied permission, the app falls back to the system WebView's Geolocation API. Devices without Google only need Android System WebView. Not verified on a real device without Play Services.

`INTERNET` is **added by default** (`npm run cap:sync` does it) — it is needed only for the optional, off-by-default online map. Everything else in the app still cannot open external connections (CSP). For a strict build where the OS itself forbids network access run `node scripts/configure-native.mjs --offline-only` (the online map becomes unavailable; add maps by file). `npm run cap:sync` restores the default.

## Background tracking (Android)

*Profile → Settings → Background tracking.* After you confirm, the app starts a foreground service with a persistent notification (a *Stop* button is right in the shade). While the phone is in your pocket the position is queued on the device; when you return, the queued points are replayed in order — fog clears along the whole path and distance and area are counted as usual. It uses the system GPS, no Google Play services.

* Android 13+: allow notifications, otherwise recording works but the notification is not shown.
* On some phones (Xiaomi, Huawei, Samsung, …) the battery manager restricts background services: disable battery optimisation for TravelOpenMap and allow autostart.
* Verified: the service and plugin compile on CI, replay order is covered by unit tests. **Not verified on a device:** the service on a real phone and vendor-specific behaviour. iOS has no background tracking (it needs a separate native module).

## 5. iOS (macOS only)

```bash
npm run cap:sync && (cd ios/App && pod install)
npm run ios             # opens Xcode → select Team under Signing & Capabilities → Run ▶
```

Permission strings (location, camera, microphone, photos, motion) are added to `Info.plist` by the configure script.

## 6. Offline maps

The Monaco demo (`public/maps/monaco.pmtiles`) is bundled. **Online map (with your consent):** after onboarding and the tutorial the app asks whether to switch on the online map ([OpenFreeMap](https://openfreemap.org)): tiles load as you browse and are cached. The Subway, Outdoors and Elevation layers are toggled with the layers button on the map. To keep a map for use without a connection, save the area: *Profile → Offline maps → Pick a country* → detail level → *Save for offline* (an area is capped at 80,000 tiles); zooming into an unfamiliar area offers to save it too. Details: [docs/MAP_SOURCES.md](docs/MAP_SOURCES.md) (Russian). Or add your own via *Profile → Offline maps → Import .pmtiles*, or drop the file into `public/maps/` and register it in `public/maps/manifest.json`. To produce a file:

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
| Blank screen on Android in the `--offline-only` build | Untested on device. Go back to the default build with `npm run cap:sync` (adds INTERNET; CSP still blocks external connections) and open an issue. |
| “Download map” disabled | Enable *Allow map downloads* and enter a source URL. Without it the app deliberately sends nothing. |
| Country download fails (network/CORS/“not a vector map”) | The source must be PMTiles v3 vector tiles with HTTP Range + CORS; use *Check source*. Otherwise download the file manually and import it. |
| Workout not recording the route | Like fog, workouts are recorded only while the app is on screen; check location permission and *Settings → GPS accuracy*. |
| Fog not clearing | Location permission; *Settings → GPS accuracy*; you may be inside an excluded zone. |
| Compass silent | iOS needs a tap on “Allow” in the Compass sheet; emulators have no sensor. |
| Tiles fail from the bundled file on iOS | `capacitor://` scheme + HTTP Range; import the map via the app instead (read as a `File`, no HTTP). |
| `SDK location not found` | Set `ANDROID_HOME` or `android/local.properties` (`sdk.dir=…`). |
