#!/usr/bin/env python3
"""
Строит правдоподобный пеший маршрут по улицам из .osm.pbf (для демо-данных и скриншотов).
Маршрут — кратчайшие пути по пешеходному графу между заданными точками интереса.

    python tools/make-demo-route.py monaco.osm.pbf src/dev/demo-route.json
"""
import heapq
import json
import math
import sys

import osmium

WALK = {"footway", "path", "pedestrian", "steps", "residential", "service", "living_street", "tertiary",
        "secondary", "primary", "unclassified", "cycleway", "track"}
# (lat, lon) — последовательность точек интереса в Монако
WAYPOINTS = [
    (43.7286, 7.4177),   # Фонвьей
    (43.7311, 7.4200),   # Дворец
    (43.7355, 7.4227),   # порт Эркюль
    (43.7318, 7.4258),   # сады Сен-Мартен
    (43.7355, 7.4227),
    (43.7397, 7.4276),   # казино Монте-Карло
    (43.7440, 7.4300),   # Ларвотто
    (43.7397, 7.4276),
]


def hav(a, b):
    R = 6371008.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    dp = p2 - p1
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def main(src, dst):
    coords, adj = {}, {}
    for o in osmium.FileProcessor(src).with_locations().with_filter(osmium.filter.KeyFilter("highway")):
        if not o.is_way() or o.tags.get("highway") not in WALK:
            continue
        if o.tags.get("access") in ("private", "no") or o.tags.get("foot") == "no":
            continue
        ns = [(n.ref, (n.lat, n.lon)) for n in o.nodes if n.location.valid()]
        for (r1, c1), (r2, c2) in zip(ns, ns[1:]):
            coords[r1], coords[r2] = c1, c2
            d = hav(c1, c2)
            adj.setdefault(r1, []).append((r2, d))
            adj.setdefault(r2, []).append((r1, d))

    # крупнейшая компонента связности — иначе ближайший узел может оказаться на «острове»
    seen, best = set(), []
    for start in adj:
        if start in seen:
            continue
        comp, stack = [], [start]
        seen.add(start)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v, _ in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        if len(comp) > len(best):
            best = comp
    main_comp = set(best)

    def nearest(p):
        return min(main_comp, key=lambda r: hav(coords[r], p))

    def dijkstra(a, b):
        dist, prev, pq = {a: 0}, {}, [(0, a)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == b:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        path, u = [b], b
        while u != a:
            u = prev[u]
            path.append(u)
        return path[::-1]

    nodes = [nearest(w) for w in WAYPOINTS]
    full = []
    for a, b in zip(nodes, nodes[1:]):
        seg = dijkstra(a, b)
        full += seg if not full else seg[1:]
    pts = [coords[r] for r in full]

    # уплотняем до шага ~8 м
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        d = hav(a, b)
        n = max(1, int(d // 8))
        for i in range(1, n + 1):
            t = i / n
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    total = sum(hav(a, b) for a, b in zip(out, out[1:]))
    json.dump([[round(lo, 6), round(la, 6)] for la, lo in out], open(dst, "w"), separators=(",", ":"))
    print(f"{len(out)} точек, {total / 1000:.2f} км → {dst}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
