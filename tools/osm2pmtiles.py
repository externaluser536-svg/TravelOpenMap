#!/usr/bin/env python3
"""
osm2pmtiles.py — офлайн-конвертер OpenStreetMap (.osm.pbf) в PMTiles.

Делает из выгрузки OSM (например, с Geofabrik) один файл векторных тайлов
`.pmtiles` в схеме Protomaps Basemaps v5 — той же, которую понимает стиль
приложения (@protomaps/basemaps). Файл кладётся в приложение и читается
локально, поэтому карта работает без интернета и без единого внешнего запроса.

Подходит для города / региона (десятки МБ исходных данных). Для стран и
континентов используйте Planetiler или `pmtiles extract` (см. INSTALLATION.md).

Зависимости:  pip install osmium shapely mapbox-vector-tile pmtiles numpy

Пример:
    python tools/osm2pmtiles.py monaco.osm.pbf public/maps/monaco.pmtiles \
        --name "Монако" --maxzoom 15 --langs en,ru,fr
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field

import mapbox_vector_tile
import numpy as np
import osmium
import shapely
import shapely.wkb as swkb
from osmium.geom import WKBFactory
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import write as pmtiles_write
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
    box,
)
from shapely.ops import linemerge, polygonize, unary_union

R = 6378137.0
ORIGIN = math.pi * R          # половина мировой ширины в метрах (Web Mercator)
EXTENT = 4096                 # разрешение тайла MVT
BUFFER = 64                   # буфер вокруг тайла (в единицах EXTENT)


# --------------------------------------------------------------------------- #
# Геометрия / проекция
# --------------------------------------------------------------------------- #
def to_mercator(geom):
    def fn(c: np.ndarray) -> np.ndarray:
        out = np.empty_like(c, dtype="float64")
        out[:, 0] = np.radians(c[:, 0]) * R
        lat = np.clip(c[:, 1], -85.0511, 85.0511)
        out[:, 1] = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R
        return out
    return shapely.transform(geom, fn)


def mpp(z: int) -> float:
    """Метров на пиксель (тайл 256 px) на экваторе."""
    return 2 * ORIGIN / (256 * 2 ** z)


def tile_bounds(z: int, x: int, y: int):
    size = 2 * ORIGIN / 2 ** z
    minx = -ORIGIN + x * size
    maxy = ORIGIN - y * size
    return minx, maxy - size, minx + size, maxy, size


def tiles_for_bounds(z: int, b) -> tuple[int, int, int, int]:
    n = 2 ** z
    size = 2 * ORIGIN / n
    x0 = max(0, int((b[0] + ORIGIN) // size))
    x1 = min(n - 1, int((b[2] + ORIGIN) // size))
    y0 = max(0, int((ORIGIN - b[3]) // size))
    y1 = min(n - 1, int((ORIGIN - b[1]) // size))
    return x0, y0, x1, y1


# --------------------------------------------------------------------------- #
# Модель объектов
# --------------------------------------------------------------------------- #
@dataclass
class Feature:
    layer: str
    geom: object            # shapely, Web Mercator
    props: dict
    minzoom: int = 0
    maxzoom: int = 99
    _cache: dict = field(default_factory=dict, repr=False)


def is_poly(g) -> bool:
    return g.geom_type in ("Polygon", "MultiPolygon")


def is_line(g) -> bool:
    return g.geom_type in ("LineString", "MultiLineString")


# --------------------------------------------------------------------------- #
# Классификация тегов OSM → схема Protomaps
# --------------------------------------------------------------------------- #
def names(tags, langs) -> dict:
    out = {}
    n = tags.get("name")
    if n:
        out["name"] = n
    for lang in langs:
        v = tags.get(f"name:{lang}")
        if v:
            out[f"name:{lang}"] = v
    return out


HIGHWAY = {
    # OSM highway=* : (kind, minzoom, ширина-приоритет)
    "motorway": ("highway", 3), "motorway_link": ("highway", 9),
    "trunk": ("major_road", 5), "trunk_link": ("major_road", 9),
    "primary": ("major_road", 7), "primary_link": ("major_road", 10),
    "secondary": ("major_road", 9), "secondary_link": ("major_road", 11),
    "tertiary": ("major_road", 11), "tertiary_link": ("major_road", 12),
    "residential": ("minor_road", 12), "unclassified": ("minor_road", 12),
    "living_street": ("minor_road", 13), "road": ("minor_road", 13),
    "service": ("minor_road", 14),
    "pedestrian": ("path", 13), "footway": ("path", 14), "path": ("path", 14),
    "cycleway": ("path", 14), "steps": ("path", 15), "bridleway": ("path", 15),
    "track": ("path", 14), "corridor": ("path", 16),
}


def classify_road(tags):
    hw = tags.get("highway")
    rw = tags.get("railway")
    if hw in HIGHWAY:
        kind, minz = HIGHWAY[hw]
        p = {"kind": kind, "kind_detail": hw.replace("_link", "")}
        if hw.endswith("_link"):
            p["is_link"] = True
        if tags.get("service") in ("driveway", "parking_aisle", "alley"):
            minz = max(minz, 16)
        if hw == "footway" and tags.get("footway") in ("sidewalk", "crossing"):
            minz = 16
        p["min_zoom"] = minz
        return p, minz
    if rw in ("rail", "light_rail", "narrow_gauge", "subway", "tram", "funicular"):
        minz = {"rail": 8, "light_rail": 11, "subway": 12, "tram": 13}.get(rw, 12)
        if tags.get("service") in ("siding", "yard", "spur"):
            minz = max(minz, 13)
        return {"kind": "rail", "kind_detail": rw, "min_zoom": minz}, minz
    if tags.get("aeroway") in ("runway", "taxiway"):
        return {"kind": tags["aeroway"], "min_zoom": 11}, 11
    if tags.get("man_made") == "pier":
        return {"kind": "other", "kind_detail": "pier", "min_zoom": 13}, 13
    if tags.get("route") == "ferry":
        return {"kind": "other", "kind_detail": "ferry", "min_zoom": 10}, 10
    return None, 0


LANDUSE = {
    ("leisure", "park"): "park", ("leisure", "garden"): "garden",
    ("leisure", "nature_reserve"): "nature_reserve",
    ("leisure", "golf_course"): "golf_course", ("leisure", "playground"): "playground",
    ("leisure", "pitch"): "pitch", ("leisure", "stadium"): "stadium",
    ("boundary", "national_park"): "national_park",
    ("boundary", "protected_area"): "protected_area",
    ("landuse", "forest"): "forest", ("natural", "wood"): "wood",
    ("landuse", "grass"): "grassland", ("natural", "grassland"): "grassland",
    ("landuse", "meadow"): "grassland", ("natural", "heath"): "scrub",
    ("natural", "scrub"): "scrub", ("landuse", "cemetery"): "cemetery",
    ("landuse", "allotments"): "allotments", ("landuse", "village_green"): "village_green",
    ("landuse", "recreation_ground"): "park", ("landuse", "farmland"): "farmland",
    ("landuse", "industrial"): "industrial", ("landuse", "military"): "military",
    ("amenity", "school"): "school", ("amenity", "university"): "university",
    ("amenity", "college"): "college", ("amenity", "hospital"): "hospital",
    ("natural", "beach"): "beach", ("natural", "sand"): "sand",
    ("tourism", "zoo"): "zoo", ("aeroway", "aerodrome"): "aerodrome",
    ("man_made", "pier"): "pier", ("natural", "bare_rock"): "barren",
}
# ("kind", максимальная «детализация»: мин. площадь полигона в пикселях² для показа)
LANDUSE_KEYS = ("leisure", "boundary", "landuse", "natural", "amenity", "tourism", "aeroway", "man_made")


def classify_landuse(tags):
    for k in LANDUSE_KEYS:
        v = tags.get(k)
        if (k, v) in LANDUSE:
            return LANDUSE[(k, v)]
    if tags.get("highway") == "pedestrian" and tags.get("area") == "yes":
        return "pedestrian"
    return None


def classify_water_area(tags):
    if tags.get("natural") == "water" or tags.get("waterway") == "riverbank" or \
            tags.get("landuse") in ("reservoir", "basin") or tags.get("natural") == "bay":
        return "lake" if tags.get("natural") == "water" and tags.get("water") != "river" else "water"
    return None


WATERWAY = {"river": ("river", 8), "canal": ("river", 12), "stream": ("stream", 13),
            "ditch": ("stream", 15), "drain": ("stream", 15)}


def classify_poi(tags):
    """Возвращает (kind, minzoom, name_required) для точечных объектов."""
    a, s, t, l = tags.get("amenity"), tags.get("shop"), tags.get("tourism"), tags.get("leisure")
    if a in ("restaurant", "fast_food", "cafe"):
        return a, 16, True
    if a in ("bar", "pub", "biergarten"):
        return "bar", 16, True
    if a in ("library", "school", "post_office", "townhall", "theatre", "toilets", "drinking_water"):
        return a, {"school": 15, "library": 15, "post_office": 16, "townhall": 15, "theatre": 15}.get(a, 17), a not in ("toilets", "drinking_water")
    if a in ("university", "college"):
        return "university", 15, True
    if a == "bench":
        return "bench", 18, False
    if a == "ferry_terminal":
        return "ferry_terminal", 14, True
    if s in ("supermarket", "convenience", "books", "electronics", "clothes"):
        return s, 16, True
    if s in ("hairdresser", "beauty"):
        return "beauty", 17, True
    if t in ("museum", "attraction", "artwork", "zoo"):
        return t, {"museum": 14, "attraction": 14, "artwork": 17, "zoo": 13}[t], True
    if t in ("viewpoint", "gallery"):
        return ("attraction" if t == "viewpoint" else "museum"), 15, True
    if l in ("park", "garden", "stadium", "marina"):
        return l, {"park": 14, "garden": 15, "stadium": 14, "marina": 14}[l], True
    if tags.get("natural") == "peak":
        return "peak", 12, True
    if tags.get("natural") == "beach":
        return "beach", 14, True
    if tags.get("aeroway") == "aerodrome":
        return "aerodrome", 11, True
    if tags.get("railway") in ("station", "halt") or tags.get("public_transport") == "station":
        if tags.get("railway") == "tram_stop":
            return None
        return "station", 13, True
    if tags.get("highway") == "bus_stop":
        return "bus_stop", 17, False
    return None


PLACE = {
    "country": ("country", None, 1), "state": ("region", None, 4), "region": ("region", None, 4),
    "city": ("locality", "city", 8), "town": ("locality", "town", 10),
    "village": ("locality", "village", 12), "hamlet": ("locality", "hamlet", 13),
    "suburb": ("macrohood", "suburb", 12), "quarter": ("neighbourhood", "quarter", 13),
    "neighbourhood": ("neighbourhood", "neighbourhood", 14), "borough": ("macrohood", "borough", 12),
}


def population_rank(tags, place):
    try:
        pop = int(str(tags.get("population", "")).replace(" ", "").replace(",", ""))
        return max(1, min(18, int(math.log2(max(pop, 2)))))
    except ValueError:
        return {"city": 12, "town": 10, "village": 8, "hamlet": 6}.get(place, 8)


# --------------------------------------------------------------------------- #
# Чтение PBF
# --------------------------------------------------------------------------- #
def read_osm(path: str, langs: list[str], maxzoom: int):
    wkb = WKBFactory()
    feats: list[Feature] = []
    coast: list[LineString] = []
    seen_poi: set = set()
    counts = defaultdict(int)

    def geom_from(fn, obj):
        try:
            return swkb.loads(fn(obj), hex=True)
        except Exception:
            return None

    def add(layer, g, props, minzoom=0):
        if g is None or g.is_empty:
            return
        feats.append(Feature(layer, to_mercator(g), props, minzoom))
        counts[layer] += 1

    fp = osmium.FileProcessor(path).with_locations().with_areas()
    for o in fp:
        tags = o.tags
        if len(tags) == 0:
            continue
        t = {k: v for k, v in ((tag.k, tag.v) for tag in tags)}

        # ---------------------------- Узлы -------------------------------- #
        if o.is_node():
            p = t.get("place")
            if p in PLACE and t.get("name"):
                kind, detail, minz = PLACE[p]
                props = {"kind": kind, **names(t, langs), "min_zoom": minz,
                         "population_rank": population_rank(t, p), "sort_key": 100 - population_rank(t, p)}
                if detail:
                    props["kind_detail"] = detail
                if t.get("capital") in ("yes", "4"):
                    props["capital"] = "yes"
                add("places", geom_from(wkb.create_point, o), props, minz)
                continue
            if p in ("sea", "ocean") and t.get("name"):
                add("water", geom_from(wkb.create_point, o), {"kind": p, **names(t, langs)}, 0)
                continue
            poi = classify_poi(t)
            if poi:
                kind, minz, need_name = poi
                if need_name and not t.get("name"):
                    continue
                key = (kind, t.get("name"))
                if t.get("name") and key in seen_poi:
                    continue
                seen_poi.add(key)
                add("pois", geom_from(wkb.create_point, o),
                    {"kind": kind, **names(t, langs), "min_zoom": minz}, minz)
            continue

        # ---------------------------- Линии ------------------------------- #
        if o.is_way():
            if t.get("natural") == "coastline":
                g = geom_from(wkb.create_linestring, o)
                if g is not None:
                    coast.append(to_mercator(g))
                continue
            road, minz = classify_road(t)
            if road:
                g = geom_from(wkb.create_linestring, o)
                if g is None or g.is_empty:
                    continue
                props = dict(road, **names(t, langs))
                if t.get("bridge") not in (None, "no"):
                    props["is_bridge"] = True
                if t.get("tunnel") not in (None, "no") or t.get("covered") == "yes":
                    props["is_tunnel"] = True
                if t.get("oneway") in ("yes", "1", "true"):
                    props["oneway"] = "yes"
                if t.get("ref"):
                    props["ref"] = t["ref"]
                add("roads", g, props, minz)
                continue
            ww = t.get("waterway")
            if ww in WATERWAY:
                kind, minz = WATERWAY[ww]
                g = geom_from(wkb.create_linestring, o)
                add("water", g, {"kind": kind, "kind_detail": ww, **names(t, langs)}, minz)
                continue
            continue

        # ---------------------------- Площади ----------------------------- #
        if o.is_area():
            # разбор только тех областей, что нужны слоям
            g = None

            def poly():
                nonlocal g
                if g is None:
                    g = geom_from(wkb.create_multipolygon, o)
                return g

            b = t.get("building") or t.get("building:part")
            if b and b != "no":
                pg = poly()
                if pg is not None:
                    h = t.get("height") or t.get("building:height")
                    props = {"kind": "building_part" if t.get("building:part") and not t.get("building") else "building",
                             "kind_detail": b if b != "yes" else "building"}
                    hv = None
                    try:
                        hv = float(str(h).replace("m", "").strip()) if h else None
                    except ValueError:
                        hv = None
                    if hv is None and t.get("building:levels"):
                        try:
                            hv = float(t["building:levels"]) * 3.0
                        except ValueError:
                            pass
                    if hv:
                        props["height"] = round(hv, 1)
                    add("buildings", pg, props, 14)
                    # POI из здания (музеи, отели и т.п.)
                    poi = classify_poi(t)
                    if poi and t.get("name"):
                        kind, minz, _ = poi
                        key = (kind, t.get("name"))
                        if key not in seen_poi:
                            seen_poi.add(key)
                            add("pois", pg.representative_point(),
                                {"kind": kind, **names(t, langs), "min_zoom": minz}, minz)
                    continue

            w = classify_water_area(t)
            if w:
                pg = poly()
                add("water", pg, {"kind": w, **names(t, langs)}, 0)
                continue

            lu = classify_landuse(t)
            if lu:
                pg = poly()
                if pg is not None:
                    props = {"kind": lu, **names(t, langs)}
                    add("landuse", pg, props, 0)
                    poi = classify_poi(t)
                    if poi and t.get("name"):
                        kind, minz, _ = poi
                        key = (kind, t.get("name"))
                        if key not in seen_poi:
                            seen_poi.add(key)
                            add("pois", pg.representative_point(),
                                {"kind": kind, **names(t, langs), "min_zoom": minz}, minz)
                continue

            # прочие POI-площади (не здания)
            poi = classify_poi(t)
            if poi and t.get("name"):
                kind, minz, _ = poi
                key = (kind, t.get("name"))
                if key not in seen_poi:
                    seen_poi.add(key)
                    pg = poly()
                    if pg is not None:
                        add("pois", pg.representative_point(),
                            {"kind": kind, **names(t, langs), "min_zoom": minz}, minz)
                continue

            # административные границы
            if t.get("boundary") == "administrative" and t.get("admin_level", "").isdigit():
                lvl = int(t["admin_level"])
                if lvl <= 8:
                    pg = poly()
                    if pg is not None:
                        bnd = pg.boundary
                        add("boundaries", bnd, {"kind": "country" if lvl == 2 else "region" if lvl <= 4 else "locality",
                                                "kind_detail": lvl}, {2: 0, 4: 4, 6: 8, 8: 10}.get(lvl, 8))
    return feats, coast, dict(counts)


# --------------------------------------------------------------------------- #
# Океан из береговой линии
# --------------------------------------------------------------------------- #
def build_ocean(coast: list[LineString], bounds) -> list[Polygon]:
    """Строит полигоны моря: суша слева от береговой линии (правило OSM)."""
    if not coast:
        return []
    frame = box(*bounds)
    merged = linemerge(unary_union(coast))
    lines = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
    ext = []
    far = 1e7
    for ln in lines:
        c = list(ln.coords)
        if ln.is_closed:
            ext.append(ln)
            continue
        # достраиваем открытые концы до рамки области вдоль последнего сегмента
        head = list(c)
        for idx, (p, q) in ((0, (c[1], c[0])), (-1, (c[-2], c[-1]))):
            dx, dy = q[0] - p[0], q[1] - p[1]
            n = math.hypot(dx, dy) or 1.0
            ray = LineString([q, (q[0] + dx / n * far, q[1] + dy / n * far)])
            hit = ray.intersection(frame.boundary)
            if hit.is_empty:
                continue
            pt = hit if hit.geom_type == "Point" else min(hit.geoms, key=lambda g: g.distance(Point(q)))
            if idx == 0:
                head.insert(0, (pt.x, pt.y))
            else:
                head.append((pt.x, pt.y))
        ext.append(LineString(head))
    pieces = list(polygonize(unary_union(ext + [frame.boundary])))
    coast_union = unary_union(ext)
    ocean = []
    for pc in pieces:
        if not frame.buffer(1).contains(pc):
            continue
        rp = pc.representative_point()
        # ближайший сегмент береговой линии → сторона (слева = суша)
        best = None
        for ln in (coast_union.geoms if hasattr(coast_union, "geoms") else [coast_union]):
            d = ln.distance(rp)
            if best is None or d < best[0]:
                best = (d, ln)
        ln = best[1]
        pos = ln.project(rp)
        a = ln.interpolate(max(pos - 1.0, 0))
        b = ln.interpolate(pos + 1.0)
        cross = (b.x - a.x) * (rp.y - a.y) - (b.y - a.y) * (rp.x - a.x)
        if cross < 0:            # справа от линии → вода
            ocean.append(pc)
    return ocean


# --------------------------------------------------------------------------- #
# Нарезка на тайлы
# --------------------------------------------------------------------------- #
def keep_parts(g, want_poly: bool | None):
    """Оставляет из GeometryCollection только нужные типы."""
    if g.is_empty:
        return None
    t = g.geom_type
    if t in ("Point", "MultiPoint"):
        return g
    if want_poly is True:
        if t in ("Polygon", "MultiPolygon"):
            return g
        if t == "GeometryCollection":
            parts = [x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
            return unary_union(parts) if parts else None
        return None
    if want_poly is False:
        if t in ("LineString", "MultiLineString"):
            return g
        if t == "GeometryCollection":
            parts = [x for x in g.geoms if x.geom_type in ("LineString", "MultiLineString")]
            return MultiLineString([p for x in parts for p in (x.geoms if hasattr(x, "geoms") else [x])]) if parts else None
        return None
    return g


def clean_props(p: dict) -> dict:
    return {k: v for k, v in p.items() if v is not None and v != ""}


def build_tiles(feats: list[Feature], bounds, minzoom, maxzoom, ocean_polys):
    tiles: dict[tuple[int, int, int], dict[str, list]] = defaultdict(lambda: defaultdict(list))
    frame = box(*bounds)
    earth = Feature("earth", frame, {"kind": "earth"}, 0)
    all_feats = [earth] + [Feature("water", o, {"kind": "ocean"}, 0) for o in ocean_polys] + feats

    for z in range(minzoom, maxzoom + 1):
        t0 = time.time()
        px = mpp(z)
        tol = px * (0.6 if z < maxzoom else 0.05)
        min_area = (px * 3) ** 2
        n_in = 0
        for f in all_feats:
            if z < f.minzoom or z > f.maxzoom:
                continue
            g = f.geom
            gt = g.geom_type
            if gt in ("Polygon", "MultiPolygon"):
                if f.layer not in ("earth",) and g.area < min_area and f.layer != "buildings":
                    continue
                if f.layer == "buildings" and g.area < (px * 1.5) ** 2:
                    continue
                if z < maxzoom and f.layer != "earth":
                    g = g.simplify(tol, preserve_topology=True)
                    if g.is_empty:
                        continue
                if not g.is_valid:
                    g = shapely.make_valid(g)
            elif gt in ("LineString", "MultiLineString"):
                if z < maxzoom:
                    g = g.simplify(tol, preserve_topology=False)
                    if g.is_empty:
                        continue
            want = True if gt in ("Polygon", "MultiPolygon") else False if gt in ("LineString", "MultiLineString") else None
            b = g.bounds
            x0, y0, x1, y1 = tiles_for_bounds(z, b)
            for tx in range(x0, x1 + 1):
                for ty in range(y0, y1 + 1):
                    minx, miny, maxx, maxy, size = tile_bounds(z, tx, ty)
                    buf = size * BUFFER / EXTENT
                    if gt == "Point":
                        if not (minx <= g.x < maxx and miny <= g.y < maxy):
                            continue
                        cg = g
                    else:
                        cg = shapely.clip_by_rect(g, minx - buf, miny - buf, maxx + buf, maxy + buf)
                        cg = keep_parts(cg, want)
                        if cg is None or cg.is_empty:
                            continue
                    tiles[(z, tx, ty)][f.layer].append((cg, f.props))
                    n_in += 1
        print(f"  z{z:<2} tiles={sum(1 for k in tiles if k[0] == z):<5} features={n_in:<7} {time.time() - t0:5.1f}s", flush=True)
    return tiles


def encode_tile(z, x, y, layers) -> bytes:
    minx, miny, maxx, maxy, _ = tile_bounds(z, x, y)
    out = []
    for name, items in layers.items():
        feats = []
        for g, props in items:
            feats.append({"geometry": g, "properties": clean_props(props)})
        out.append({"name": name, "features": feats})
    return mapbox_vector_tile.encode(
        out, default_options={"quantize_bounds": (minx, miny, maxx, maxy), "extents": EXTENT, "y_coord_down": False}
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help=".osm.pbf")
    ap.add_argument("output", help=".pmtiles")
    ap.add_argument("--name", default=None, help="Название карты (в метаданных)")
    ap.add_argument("--minzoom", type=int, default=0)
    ap.add_argument("--maxzoom", type=int, default=15)
    ap.add_argument("--langs", default="en,ru", help="Языки name:<lang>, через запятую")
    args = ap.parse_args()
    langs = [x for x in args.langs.split(",") if x]

    t0 = time.time()
    header = osmium.io.Reader(args.input).header()
    box_ = header.box()
    if not box_.valid():
        print("В заголовке PBF нет bbox; укажите файл-выгрузку с границами.", file=sys.stderr)
        return 2
    lon0, lat0, lon1, lat1 = box_.bottom_left.lon, box_.bottom_left.lat, box_.top_right.lon, box_.top_right.lat
    (mx0, my0), (mx1, my1) = to_mercator(Point(lon0, lat0)).coords[0], to_mercator(Point(lon1, lat1)).coords[0]
    bounds = (mx0, my0, mx1, my1)

    print(f"[1/4] Чтение {args.input} …")
    feats, coast, counts = read_osm(args.input, langs, args.maxzoom)
    print("      объектов:", counts, f"береговых линий: {len(coast)}  ({time.time() - t0:.1f}s)")

    print("[2/4] Море из береговой линии …")
    ocean = build_ocean(coast, bounds)
    print(f"      полигонов моря: {len(ocean)}")

    print("[3/4] Нарезка тайлов …")
    tiles = build_tiles(feats, bounds, args.minzoom, args.maxzoom, ocean)

    print(f"[4/4] Запись {args.output} …")
    e7 = lambda v: int(round(v * 1e7))
    clon, clat = (lon0 + lon1) / 2, (lat0 + lat1) / 2
    fields = defaultdict(set)
    for f in feats:
        fields[f.layer].update(f.props.keys())
    meta = {
        "name": args.name or args.output,
        "description": "Офлайн-выгрузка OpenStreetMap для TravelOpenMap",
        "version": "1",
        "type": "baselayer",
        "format": "pbf",
        "attribution": '<a href="https://www.openstreetmap.org/copyright">© участники OpenStreetMap</a> (ODbL)',
        "generator": "TravelOpenMap tools/osm2pmtiles.py",
        "vector_layers": [
            {"id": lid, "fields": {k: "String" for k in sorted(fields.get(lid, []))}, "minzoom": args.minzoom, "maxzoom": args.maxzoom}
            for lid in ("earth", "water", "landuse", "roads", "buildings", "pois", "places", "boundaries")
        ],
    }
    total = 0
    with pmtiles_write(args.output) as w:
        for (z, x, y) in sorted(tiles, key=lambda k: zxy_to_tileid(*k)):
            data = gzip.compress(encode_tile(z, x, y, tiles[(z, x, y)]), 9)
            w.write_tile(zxy_to_tileid(z, x, y), data)
            total += 1
        w.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": args.minzoom,
                "max_zoom": args.maxzoom,
                "min_lon_e7": e7(lon0), "min_lat_e7": e7(lat0),
                "max_lon_e7": e7(lon1), "max_lat_e7": e7(lat1),
                "center_zoom": min(14, args.maxzoom),
                "center_lon_e7": e7(clon), "center_lat_e7": e7(clat),
            },
            meta,
        )
    import os
    print(f"Готово: {total} тайлов, {os.path.getsize(args.output) / 1e6:.2f} МБ, {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
