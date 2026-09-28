#!/usr/bin/env bash
# Собирает демо-карту (Монако) из реальной выгрузки OpenStreetMap и кладёт её в public/maps/.
# Данные берутся из открытого репозитория Project-OSRM (тестовая выгрузка Geofabrik).
#
#   npm run map:demo
#
# Для своего региона используйте свой .osm.pbf:
#   tools/build-demo-map.sh путь/к/region.osm.pbf "Название региона" region
set -euo pipefail
cd "$(dirname "$0")/.."

PBF="${1:-}"
NAME="${2:-Монако / Monaco (demo)}"
ID="${3:-monaco}"

if [ ! -d tools/.venv ]; then
  python3 -m venv tools/.venv
  tools/.venv/bin/pip install -q -r tools/requirements.txt
fi

if [ -z "$PBF" ]; then
  mkdir -p tools/.cache
  PBF=tools/.cache/monaco.osm.pbf
  if [ ! -f "$PBF" ]; then
    echo "Скачиваю выгрузку OSM (Монако)…"
    curl -fsSL -o "$PBF" https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/test/data/monaco.osm.pbf
  fi
fi

mkdir -p public/maps
tools/.venv/bin/python tools/osm2pmtiles.py "$PBF" "public/maps/${ID}.pmtiles" --name "$NAME" --maxzoom 15 --langs en,ru,fr

# регистрируем карту в манифесте (если её там ещё нет)
node -e '
const fs = require("fs");
const f = "public/maps/manifest.json";
const m = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { maps: [] };
const id = "bundled:" + process.argv[1];
if (!m.maps.some((x) => x.id === id)) m.maps.push({ id, name: process.argv[2], file: process.argv[1] + ".pmtiles" });
fs.writeFileSync(f, JSON.stringify(m, null, 2) + "\n");
' "$ID" "$NAME"
echo "Готово: public/maps/${ID}.pmtiles"
