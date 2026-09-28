# Офлайн-карты OpenStreetMap

Приложение рисует карту из **PMTiles** — одного файла с векторными тайлами (MVT) в схеме [Protomaps Basemaps](https://docs.protomaps.com/basemaps/layers). Никакого тайл-сервера: MapLibre читает нужные диапазоны байт прямо из файла.

## Сколько это весит

Планета целиком нереальна для телефона (`planet.osm.pbf` ≈ 75 ГБ, векторные тайлы до z15 > 100 ГБ). Берите регион поездки. Ориентиры (проверенные нами цифры — только первые три строки):

| Регион | Источник | Результат |
|---|---|---|
| Монако | `osm2pmtiles.py`, 1,7 МБ PBF | **0,78 МБ**, zoom 0–15, 11 с |
| Андорра (горы) | `osm2pmtiles.py`, 0,6 МБ PBF | **0,78 МБ**, 4 с |
| Утрехт (город, каналы) | `osm2pmtiles.py`, 11,8 МБ PBF | **4,65 МБ**, 83 с |
| Крупный город / область | Protomaps / Planetiler | обычно десятки–сотни МБ (не проверялось) |
| Страна | Protomaps / Planetiler | от сотен МБ до нескольких ГБ (не проверялось) |

Меньше `--maxzoom` — меньше файл: z14 примерно вдвое легче z15. Приложение «растягивает» тайлы выше максимального zoom (до 19.5), детализация зданий остаётся приемлемой.

## Способ 1 — `pmtiles extract` (быстрее всего, нужен интернет один раз)

Protomaps ежедневно публикует сборку всего мира. Утилита `pmtiles` скачивает из неё только нужный прямоугольник:

```bash
# go-pmtiles: https://github.com/protomaps/go-pmtiles/releases
pmtiles extract https://build.protomaps.com/20260901.pmtiles paris.pmtiles \
  --bbox=2.22,48.81,2.47,48.91 --maxzoom=15
```

`--bbox=west,south,east,north`. Актуальную дату сборки смотрите на <https://maps.protomaps.com/builds/>. Готовый файл — в приложение (импорт или `public/maps/`).

> В среде, где создавалось приложение, домены Protomaps были недоступны, поэтому именно эта команда здесь **не запускалась**; схема тайлов в приложении совпадает с Protomaps v5, и стиль — официальный `@protomaps/basemaps`.

## Способ 2 — `tools/osm2pmtiles.py` (полностью локально, проверено)

Конвертер `.osm.pbf` → `.pmtiles`. Читает данные через `pyosmium`, классифицирует объекты в слои Protomaps (`earth`, `water`, `landuse`, `roads`, `buildings`, `pois`, `places`, `boundaries`), режет на тайлы (`shapely`), кодирует MVT и пишет PMTiles. Море строится из береговой линии (`natural=coastline`).

```bash
python3 -m venv tools/.venv
tools/.venv/bin/pip install -r tools/requirements.txt
tools/.venv/bin/python tools/osm2pmtiles.py monaco.osm.pbf monaco.pmtiles \
    --name "Монако" --minzoom 0 --maxzoom 15 --langs en,ru,fr
```

Где взять `.osm.pbf`: <https://download.geofabrik.de> (регионы и страны), <https://download.bbbike.org/osm/> (города по вашему bbox), Overpass API (выборка по bbox → osmium convert). В PBF должен быть заголовок с bbox (у Geofabrik/BBBike он есть).

Ограничения конвертера:

* подходит для городов и небольших регионов (Python; для страны — слишком медленно и требует много памяти);
* нет слоёв `landcover`, `transit`, `natural`, дорожных щитов; границы — только `admin_level ≤ 8`, если отношение полное;
* сторона моря определяется эвристикой по направлению береговой линии; на очень сложных побережьях возможны артефакты.

## Способ 3 — Planetiler (страны, континенты)

[Planetiler](https://github.com/onthegomap/planetiler) быстро строит тайлы из `.osm.pbf`; профиль Protomaps лежит в репозитории [protomaps/basemaps](https://github.com/protomaps/basemaps) (см. его документацию по сборке: `java -jar … --osm-path=… --output=….pmtiles`). Результат подходит приложению без изменений. Этот способ здесь не запускался.

## Подключение к приложению

* **Импорт без пересборки:** *Профиль → Офлайн-карты → Импортировать .pmtiles*. Файл хранится в IndexedDB и читается через `FileSource` (без HTTP), поэтому работает одинаково на Android, iOS и в вебе.
* **Встроить в сборку:** положить в `public/maps/` и добавить в `public/maps/manifest.json`.

Приложение проверяет файл: это должен быть PMTiles с векторными тайлами (`tileType = MVT`); иначе покажет понятную ошибку.

## Шрифты и спрайты

Подписи и значки рисуются из `public/map-assets/` (шрифты Noto Sans — латиница, кириллица, греческий, пунктуация; спрайты Protomaps v4 светлые/тёмные). `npm run assets:fonts` скачивает их один раз. Для других письменностей (CJK, арабский, деванагари) добавьте диапазоны глифов в `tools/fetch-map-assets.mjs`.

## Лицензия данных

Данные © участники OpenStreetMap, лицензия ODbL. Атрибуция «© участники OpenStreetMap» показывается на карте и вшита в метаданные PMTiles.
