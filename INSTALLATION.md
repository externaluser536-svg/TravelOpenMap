# 🛠️ Установка, запуск и сборка TravelOpenMap

*[English → INSTALLATION.en.md](INSTALLATION.en.md)*

Содержание: [требования](#1-требования) · [запуск в браузере](#2-запуск-в-браузере-самый-быстрый-путь) · [проверки](#3-тесты-и-проверки) · [Android](#4-сборка-android) · [Release-сборка](#release-сборка-тестовая-версия) · [без Google Play](#работа-без-google-play-services) · [iOS](#5-сборка-ios) · [офлайн-карты](#6-офлайн-карты) · [скриншоты](#7-скриншоты-и-иконки) · [решение проблем](#8-решение-проблем)

---

## 1. Требования

| Для чего | Что нужно |
|---|---|
| Всё | **Node.js ≥ 20** (проверено на 22) и npm |
| Android | **JDK 17+**, **Android Studio** (Hedgehog или новее) с Android SDK 36, эмулятор или телефон с включённой отладкой по USB |
| iOS | **macOS**, **Xcode 15+**, **CocoaPods** (`sudo gem install cocoapods`), аккаунт Apple Developer для установки на устройство |
| Свои карты из `.osm.pbf` | **Python ≥ 3.10** (для `tools/osm2pmtiles.py`) |
| Скриншоты и e2e-тесты | Chromium (Playwright): `npx playwright install chromium` |

## 2. Запуск в браузере (самый быстрый путь)

```bash
git clone https://github.com/externaluser536-svg/TravelOpenMap.git
cd TravelOpenMap
git checkout claude/dreamy-gauss-2mrns2      # ветка с приложением

npm install
npm run dev
```

Откройте <http://localhost:5173>. Чтобы увидеть приложение «в деле» без прогулки по Монако, откройте **<http://localhost:5173/?demo>** — загрузятся демо-данные: пеший маршрут по реальным улицам Монако, заметки с фото, история за 2 недели.

* Геолокация в браузере работает на `localhost` (спросит разрешение). Для проверки без выхода из дома используйте эмуляцию: DevTools → Sensors → Location.
* Камера/видео: кнопки «Фото»/«Видео» открывают выбор файла (на телефоне — камеру).
* Компас в десктопном браузере недоступен (нет датчика) — на телефоне заработает.

Продакшн-сборка для веба (PWA-подобная, статические файлы):

```bash
npm run build            # → dist/  (проверка типов + сборка)
npm run preview          # http://localhost:4173
```

`dist/` можно положить на любой статический хостинг — но нужен доступ к файлам карты (`dist/maps/*.pmtiles`) с поддержкой HTTP Range (это умеют nginx, Caddy, GitHub Pages, Netlify и `vite preview`).

## 3. Тесты и проверки

```bash
npm run typecheck     # TypeScript
npm test              # 84 юнит-теста: гео, туман, уровни, челленджи, тренировки, поездки, статистика, экстрактор карт, БД, движок, i18n
npm run test:e2e      # сборка + проверка «0 внешних запросов» (Playwright/Chromium)
npm run test:all      # всё вышеперечисленное
```

`test:e2e` запускает продакшн-сборку в Chromium **с отключённым DNS для внешних хостов**, эмулирует GPS-прогулку, создаёт заметку с фото и проверяет, что ни один запрос не покинул локальный origin, а попытки `fetch`/`<img>`/`WebSocket` наружу блокируются политикой CSP. Дополнительно проверяется, что сетевой шлюз загрузки карт по умолчанию неактивен (нет iframe, кнопка «Скачать» недоступна).

## 4. Сборка Android

Один раз (создаёт/обновляет нативный проект и настраивает разрешения):

```bash
npm install
npm run cap:sync        # сборка веб-части → npx cap sync → scripts/configure-native.mjs
```

Проект `android/` уже лежит в репозитории. Дальше — на выбор.

**А) Через Android Studio (рекомендуется для первого запуска)**

```bash
npm run android         # соберёт веб-часть, синхронизирует и откроет Android Studio
```

В Android Studio дождитесь синхронизации Gradle → выберите устройство/эмулятор → ▶ **Run**.

**Б) Из командной строки — отладочный APK**

```bash
export ANDROID_HOME=$HOME/Android/Sdk        # путь к вашему Android SDK
npm run android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

**В) Релизная сборка (AAB для Google Play / подписанный APK)**

1. Создайте ключ: `keytool -genkey -v -keystore travelopenmap.jks -keyalg RSA -keysize 2048 -validity 10000 -alias tom`
2. Android Studio → *Build → Generate Signed Bundle / APK* (или настройте `signingConfigs` в `android/app/build.gradle`).
3. Храните `.jks` и пароли **вне репозитория**.

Идентификатор приложения — `app.travelopenmap` (меняется в [`capacitor.config.ts`](capacitor.config.ts); после смены выполните `npx cap sync`).

> ℹ️ **Разрешение `INTERNET` по умолчанию добавляется** в `AndroidManifest.xml` (`npm run cap:sync` делает это сам) — оно нужно только для необязательной, выключенной по умолчанию загрузки карт стран. Всё остальное приложение по-прежнему не имеет права на внешние соединения (CSP). Нужна строгая сборка, где сеть невозможна на уровне ОС? Выполните `node scripts/configure-native.mjs --offline-only` — `INTERNET` будет удалён, загрузка стран станет недоступной, карты добавляются файлом. Чтобы вернуть обычный режим, запустите `npm run cap:sync`.

### Release-сборка (тестовая версия)

```bash
npm run release:test        # подписанный тестовым ключом APK + AAB + веб-архив → release/
npm run release:web         # только веб-версия (zip со статикой из dist/)
npm run release:android     # Android с вашим ключом (см. ниже); без ключа — неподписанный APK
```

Результат — папка `release/`: `TravelOpenMap-<версия>-test-release.apk`, `…-release.aab`, `…-web.zip`, `SHA256SUMS.txt`. Версия берётся из `package.json` (`0.4.0` → versionName `0.4.0`, versionCode `400`).

* **Тестовый ключ.** `android/keystore/tom-test.jks` лежит в репозитории, пароли публичны (`android/keystore/test.properties`). Он нужен, чтобы тестовые APK ставились друг поверх друга. **В Google Play и для публичных релизов его использовать нельзя.**
* **Свой ключ.** Создайте: `keytool -genkeypair -v -keystore my.jks -alias tom -keyalg RSA -keysize 2048 -validity 10000`. Затем положите `android/keystore.properties` (файл в `.gitignore`):
  ```
  storeFile=../my.jks
  storePassword=…
  keyAlias=tom
  keyPassword=…
  ```
  или задайте переменные `TOM_KEYSTORE_FILE`, `TOM_KEYSTORE_PASSWORD`, `TOM_KEY_ALIAS`, `TOM_KEY_PASSWORD`. Потом `npm run release:android`.
* **Требования:** JDK 21, Android SDK (`ANDROID_HOME`), доступ к Google Maven и Maven Central для Gradle.
* **GitHub Actions.** [`.github/workflows/release-test.yml`](.github/workflows/release-test.yml) собирает то же самое на GitHub при пуше в ветку `claude/**`, по тегу `v*` или вручную и публикует **пре-релиз** (APK, AAB, веб-архив, суммы) — раздел *Releases* репозитория.
* iOS-релиз собирается только на macOS через Xcode (*Product → Archive*) с вашим Apple-аккаунтом; тестовой сборки для iOS нет.

### Работа без Google Play Services

Приложение не использует Google Maps, Firebase и другие сервисы Google: карта, шрифты и данные — на устройстве. Геолокация:

1. Нативный плагин запрашивает позицию с параметром `enableLocationFallback: true` — если Google Play Services нет или не отвечают, он переключается на системный `LocationManager` (GPS).
2. Если плагин вернул ошибку не из-за запрета доступа, приложение включает запасной путь — Geolocation API системного WebView.

Устройствам без Google (Huawei, GrapheneOS/LineageOS без GApps, часть китайских прошивок) нужен только установленный Android System WebView (Chromium). Без Wi-Fi/сотовой сети определяется только GPS-спутниками — на первое определение может уйти больше времени.

> Не проверено на реальном устройстве без Google Play Services: в среде разработки такого устройства нет; поведение опирается на документацию плагина `@capacitor/geolocation` и покрыто юнит-тестами логики запасного пути.

Что запросит приложение на Android: геолокация (точная), камера и микрофон (запись видео), датчики ориентации (без разрешения).

## 5. Сборка iOS

Только на macOS.

```bash
npm install
npm run cap:sync
cd ios/App && pod install && cd ../..    # если CocoaPods не отработал автоматически
npm run ios                              # откроет Xcode
```

В Xcode: выберите target **App** → *Signing & Capabilities* → укажите **Team** → выберите устройство/симулятор → ▶ **Run**. Тексты запросов разрешений (геолокация, камера, микрофон, фото, датчики движения) уже добавлены в `Info.plist` скриптом `scripts/configure-native.mjs`.

Для App Store: *Product → Archive → Distribute App*.

## 6. Офлайн-карты

В приложении уже есть демо-карта **Монако** (`public/maps/monaco.pmtiles`, 0,8 МБ). Чтобы ездить по миру, добавьте свои:

**Вариант 0 — загрузка страны из приложения (нужна сеть, необязательно).** *Профиль → Офлайн-карты → Добавить страну* → выберите страну и детализацию (видна оценка размера) → включите *«Разрешить загрузку карт из сети»* → укажите адрес PMTiles-источника, например сборку Protomaps `https://build.protomaps.com/ГГГГММДД.pmtiles` (актуальную дату смотрите на <https://maps.protomaps.com/builds/>) → «Проверить источник» → «Скачать карту». Сервер источника должен поддерживать HTTP Range и CORS (`Access-Control-Allow-Origin`, `Access-Control-Expose-Headers: Content-Range`); иначе будет ошибка — тогда используйте варианты ниже. Приложение выкачивает только нужные тайлы (не весь файл), лимит — 300 МБ. Своя копия источника (например, `npx http-server --cors`, `python -m http.server` с Range-поддержкой или nginx) тоже подходит — так можно раздавать карты внутри своей сети.

**Вариант 1 — импорт в приложении (без пересборки).** Получите файл `.pmtiles` нужного региона (см. ниже), скопируйте на телефон и откройте *Профиль → Офлайн-карты → Импортировать .pmtiles*. Файл сохраняется в памяти приложения; при импорте можно указать страну.

**Вариант 2 — встроить в сборку.** Положите файл в `public/maps/` и добавьте запись в `public/maps/manifest.json`:

```json
{ "maps": [ { "id": "bundled:paris", "name": "Париж", "file": "paris.pmtiles" } ] }
```

Как получить `.pmtiles` региона:

```bash
# A) вырезать область из готовой сборки Protomaps (нужен go-pmtiles: https://github.com/protomaps/go-pmtiles/releases)
pmtiles extract https://build.protomaps.com/YYYYMMDD.pmtiles paris.pmtiles --bbox=2.22,48.81,2.47,48.91 --maxzoom=15

# B) собрать самим из выгрузки OSM (.osm.pbf, например с download.geofabrik.de) — полностью локально
npm run map:demo                                   # демо: скачает Монако и соберёт
tools/build-demo-map.sh путь/region.osm.pbf "Мой регион" region
#   или напрямую:
python3 -m venv tools/.venv && tools/.venv/bin/pip install -r tools/requirements.txt
tools/.venv/bin/python tools/osm2pmtiles.py region.osm.pbf public/maps/region.pmtiles --name "Мой регион" --maxzoom 15 --langs en,ru
```

Подробности, размеры и способ для стран/континентов (Planetiler) — в [docs/OFFLINE_MAPS.md](docs/OFFLINE_MAPS.md).

Шрифты и спрайты карты (`public/map-assets/`) уже в репозитории. Пересоздать: `npm run assets:fonts` (скачивает один раз из `protomaps/basemaps-assets`; после этого интернет не нужен).

## 7. Скриншоты и иконки

```bash
npm run screenshots               # demo-сборка + все экраны (ru/en, тёмная/светлая) → docs/screenshots/
npm run icons                     # resources/*.png из public/icon.svg + иконки/сплэш для Android и iOS
```

## 8. Решение проблем

| Симптом | Причина / решение |
|---|---|
| **Пустая карта, только фон** | Файл карты не найден или не покрывает ваше место. Проверьте `public/maps/manifest.json`, откройте *Профиль → Офлайн-карты* и нажмите значок карты (перейти к области). Баннер «Здесь нет офлайн-карты» появляется, когда центр экрана вне покрытия. |
| **Белый/чёрный экран на Android в сборке `--offline-only`** | На ряде сборок WebView `https://localhost` требует разрешение. Вернитесь к обычной сборке: `npm run cap:sync` (INTERNET добавляется, CSP всё равно блокирует внешние соединения). Это не проверялось на устройстве — откройте issue, если столкнётесь. |
| **«Скачать карту» недоступна** | Включите *«Разрешить загрузку карт из сети»* и укажите адрес источника (`http(s)://…`). Без этого приложение намеренно ничего не отправляет. |
| **Ошибка при загрузке страны (сеть/CORS/«не векторная карта»)** | Источник должен быть PMTiles v3 с векторными тайлами, поддерживать HTTP Range и CORS. Проверьте кнопкой «Проверить источник». Если у сервера нет CORS — скачайте файл вручную и импортируйте. |
| **Геолокация не работает на телефоне без Google** | Проверьте разрешение «Точная геолокация» и включённый GPS; выйдите на открытое место, первое определение по GPS может занять минуты. Нужен Android System WebView. |
| **Тренировка не записывает маршрут** | Тренировка, как и туман, пишется только пока приложение на экране; проверьте разрешение геолокации и *Настройки → Точность GPS*. |
| **Туман не рассеивается** | Проверьте разрешение на геолокацию; в *Настройки → Точность GPS* сигналы хуже порога игнорируются; вы можете находиться в *исключённой зоне* (баннер). |
| **Компас не работает** | На iOS нужно нажать «Разрешить» в шторке «Компас» (жест пользователя обязателен). На эмуляторах датчика нет. |
| **Не читается карта на iOS** | WKWebView отдаёт файлы по схеме `capacitor://`; PMTiles требует HTTP Range. Если тайлы не грузятся из встроенного файла — импортируйте карту через приложение (читается как `File`, без HTTP). |
| **`vite: not found` / ошибки сборки** | Node ≥ 20, повторите `npm install`. |
| **`Gradle: SDK location not found`** | Задайте `ANDROID_HOME` или создайте `android/local.properties` с `sdk.dir=/путь/к/Android/Sdk`. |
| **Ошибка TLS при `npm run assets:fonts` за прокси** | `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/путь/к/ca.pem npm run assets:fonts`. |
| **Фото/видео не открывают камеру на Android** | Убедитесь, что в манифесте есть `CAMERA` и `RECORD_AUDIO` (добавляет `configure-native.mjs`) и разрешения выданы в настройках приложения. |
| **Сброс прогресса после переустановки** | Данные лежат в памяти приложения. Делайте резервные копии: *Профиль → Данные и копии*. |
