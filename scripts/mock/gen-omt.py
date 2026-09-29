#!/usr/bin/env python3
"""
Генерирует крошечный набор векторных тайлов в схеме OpenMapTiles (Монако и окрестности, z0–14) для проверки
онлайн-карты без доступа к OpenFreeMap: вода, суша, дороги (с тропами, велодорожкой, метро), станции, вершина, город.

  python3 scripts/mock/gen-omt.py <папка>      → <папка>/{z}/{x}/{y}.pbf
"""
import math, os, sys
import mapbox_vector_tile as mvt
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import transform

R = 6378137.0
def merc(lng, lat):
    return (R * math.radians(lng), R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))

def tile_bounds(z, x, y):
    n = 2 ** z
    size = 2 * math.pi * R / n
    minx = -math.pi * R + x * size
    maxy = math.pi * R - y * size
    return (minx, maxy - size, minx + size, maxy)

def P(coords):
    return [merc(*c) for c in coords]

# ---- «мир» вокруг Монако
sea = Polygon(P([(7.38, 43.70), (7.46, 43.70), (7.46, 43.7265), (7.44, 43.7285), (7.425, 43.7275), (7.41, 43.7295), (7.395, 43.7285), (7.38, 43.7300)]))
park = Polygon(P([(7.414, 43.735), (7.424, 43.735), (7.424, 43.742), (7.414, 43.742)]))
wood = Polygon(P([(7.430, 43.745), (7.445, 43.745), (7.445, 43.755), (7.430, 43.755)]))

def line(*pts):
    return LineString(P(pts))

roads = [
    ('primary', 'road', line((7.38, 43.735), (7.42, 43.7345), (7.46, 43.7370)), 'Avenue Principale'),
    ('secondary', 'road', line((7.40, 43.7305), (7.415, 43.7360), (7.425, 43.7440)), 'Boulevard Test'),
    ('tertiary', 'road', line((7.405, 43.741), (7.435, 43.7395)), 'Rue Tertiaire'),
    ('minor', 'road', line((7.410, 43.738), (7.428, 43.7385), (7.436, 43.7420)), 'Rue Mineure'),
    ('motorway', 'road', line((7.38, 43.752), (7.42, 43.7515), (7.46, 43.7535)), None),
    ('path', 'footway', line((7.416, 43.7362), (7.4185, 43.7388), (7.4225, 43.7405)), 'Sentier Test'),
    ('path', 'path', line((7.432, 43.746), (7.436, 43.7485), (7.4395, 43.7515)), None),
    ('path', 'cycleway', line((7.402, 43.7405), (7.4125, 43.7425), (7.4235, 43.7445)), 'Piste Cyclable'),
    ('track', 'track', line((7.427, 43.742), (7.4315, 43.7455)), None),
    ('rail', 'rail', line((7.38, 43.7325), (7.42, 43.7330), (7.46, 43.7335)), None),
]
subway = line((7.395, 43.7375), (7.4105, 43.7400), (7.4205, 43.7425), (7.436, 43.7455))
stations = [((7.4105, 43.7400), 'Станция Юг'), ((7.4205, 43.7425), 'Станция Центр'), ((7.436, 43.7455), 'Station Nord')]

def clip(geom, b):
    g = geom.intersection(box(*b).buffer((b[2] - b[0]) * 0.05))
    return None if g.is_empty else g

def encode(z, x, y):
    b = tile_bounds(z, x, y)
    layers = {}
    def add(layer, geom, props):
        g = clip(geom, b)
        if g is not None:
            layers.setdefault(layer, {'name': layer, 'features': []})['features'].append({'geometry': mapping(g), 'properties': props})
    add('water', sea, {'class': 'ocean'})
    add('landcover', park, {'class': 'grass'})
    add('landcover', wood, {'class': 'wood'})
    add('park', park, {'class': 'park', 'name': 'Jardin Test'})
    for cls, sub, geom, name in roads:
        if cls == 'motorway' and z < 5: continue
        props = {'class': cls, 'subclass': sub} if cls in ('path', 'track', 'rail') else {'class': cls}
        add('transportation', geom, props)
        if name and z >= 13:
            add('transportation_name', geom, {'name': name, 'name:ru': name, 'class': cls})
    add('transportation', subway, {'class': 'transit', 'subclass': 'subway', 'brunnel': 'tunnel'})
    add('transportation', LineString(P([(7.395, 43.7375), (7.4105, 43.7400)])), {'class': 'transit', 'subclass': 'subway'})
    for (lng, lat), name in stations:
        add('poi', Point(merc(lng, lat)), {'class': 'railway', 'subclass': 'subway', 'name': name, 'rank': 5})
    add('poi', Point(merc(7.4335, 43.7462)), {'class': 'campsite', 'subclass': 'camp_site', 'name': 'Camping Test', 'rank': 10})
    add('poi', Point(merc(7.4375, 43.7495)), {'class': 'information', 'subclass': 'viewpoint', 'name': 'Belvédère', 'rank': 12})
    add('poi', Point(merc(7.4180, 43.7385)), {'class': 'shop', 'subclass': 'bakery', 'name': 'Boulangerie', 'rank': 8})
    add('mountain_peak', Point(merc(7.4390, 43.7520)), {'class': 'peak', 'name': 'Mont Test', 'ele': 312, 'rank': 1})
    add('place', Point(merc(7.4246, 43.7384)), {'class': 'city', 'name': 'Monaco', 'name:ru': 'Монако', 'rank': 1})
    add('place', Point(merc(7.44, 43.751)), {'class': 'suburb', 'name': 'Quartier Nord', 'rank': 3})
    add('place', Point(merc(7.42, 43.70)), {'class': 'country', 'name': 'Monaco', 'name:ru': 'Монако', 'rank': 1})
    add('water_name', Point(merc(7.42, 43.715)), {'class': 'sea', 'name': 'Mer Test'})
    if not layers: return None
    return mvt.encode(list(layers.values()), default_options={'quantize_bounds': b, 'extents': 4096})

def main(out):
    lng0, lat0, lng1, lat1 = 7.38, 43.70, 7.46, 43.76
    total = 0
    for z in range(0, 15):
        n = 2 ** z
        def tx(lng): return int((lng + 180) / 360 * n)
        def ty(lat):
            l = math.radians(lat); return int((1 - math.log(math.tan(l) + 1 / math.cos(l)) / math.pi) / 2 * n)
        for x in range(tx(lng0), tx(lng1) + 1):
            for y in range(ty(lat1), ty(lat0) + 1):
                data = encode(z, x, y)
                if data is None: continue
                d = os.path.join(out, str(z), str(x)); os.makedirs(d, exist_ok=True)
                open(os.path.join(d, f'{y}.pbf'), 'wb').write(data); total += 1
    print(f'tiles: {total}')

if __name__ == '__main__':
    main(sys.argv[1])
