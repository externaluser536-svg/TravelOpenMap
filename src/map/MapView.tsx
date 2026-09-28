import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AttributionControl, Map as MlMap, Marker, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from '../state/store';
import { usePrefs, resolveTheme } from '../state/prefs';
import { engine } from '../state/engine';
import { FogRenderer } from './fog-renderer';
import { buildStyle } from './style';
import { registerPmtilesProtocol } from './pmtiles';
import { categoryById } from '../core/categories';
import { haversine, pathLength, formatDistance, type LngLat } from '../core/geo';
import { Icon } from '../ui/icons';
import { tap } from '../services/haptics';

/** Императивный доступ к карте для кнопок интерфейса. */
export const mapApi = {
  map: null as MlMap | null,
  resetNorth(): void {
    this.map?.easeTo({ bearing: 0, duration: 400 });
  },
  center(): LngLat | null {
    const c = this.map?.getCenter();
    return c ? { lng: c.lng, lat: c.lat } : null;
  },
  zoom(): number {
    return this.map?.getZoom() ?? 15;
  },
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

function measureData(points: LngLat[], units: 'metric' | 'imperial', lang: 'ru' | 'en') {
  const pts = points.map((p, i) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
    properties: { label: i === 0 ? '●' : formatDistance(pathLength(points.slice(0, i + 1)), units, lang) },
  }));
  const line = {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: points.map((p) => [p.lng, p.lat]) },
    properties: {},
  };
  return { pts: { type: 'FeatureCollection' as const, features: pts }, line: { type: 'FeatureCollection' as const, features: points.length > 1 ? [line] : [] } };
}

function addOverlays(map: MlMap): void {
  if (!map.getSource('measure-line')) {
    map.addSource('measure-line', { type: 'geojson', data: EMPTY_FC });
    map.addSource('measure-pts', { type: 'geojson', data: EMPTY_FC });
    map.addSource('track', { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getLayer('track-casing')) {
    map.addLayer({ id: 'track-casing', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': '#0b1220', 'line-width': 6, 'line-opacity': 0.5 } });
    map.addLayer({ id: 'track-line', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' }, paint: { 'line-color': '#3DDC97', 'line-width': 3.2 } });
    map.addLayer({ id: 'measure-casing', type: 'line', source: 'measure-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b1220', 'line-width': 7, 'line-opacity': 0.55 } });
    map.addLayer({ id: 'measure-line', type: 'line', source: 'measure-line', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FFB547', 'line-width': 3.5, 'line-dasharray': [2, 1.4] } });
    map.addLayer({ id: 'measure-pts', type: 'circle', source: 'measure-pts', paint: { 'circle-radius': 6.5, 'circle-color': '#FFB547', 'circle-stroke-color': '#0b1220', 'circle-stroke-width': 2.5 } });
    map.addLayer({
      id: 'measure-labels',
      type: 'symbol',
      source: 'measure-pts',
      filter: ['!=', ['get', 'label'], '●'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-offset': [0, -1.6], 'text-allow-overlap': true, 'text-anchor': 'bottom' },
      paint: { 'text-color': '#0b1220', 'text-halo-color': '#FFD08A', 'text-halo-width': 5 },
    });
  }
}

export function MapView() {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const fogRef = useRef<FogRenderer | null>(null);
  const meRef = useRef<{ marker: Marker; cone: HTMLElement } | null>(null);
  const pinsRef = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const [pins, setPins] = useState<{ id: string; el: HTMLElement }[]>([]);
  const [ready, setReady] = useState(false);

  const mapInfo = useApp((s) => s.mapInfo);
  const lang = usePrefs((s) => s.lang);
  const themePref = usePrefs((s) => s.theme);
  const units = usePrefs((s) => s.units);
  const notes = useApp((s) => s.notes);
  const peek = useApp((s) => s.peek);
  const position = useApp((s) => s.position);
  const heading = useApp((s) => s.heading);
  const follow = useApp((s) => s.follow);
  const orientMap = useApp((s) => s.orientMap);
  const flyTo = useApp((s) => s.flyTo);
  const fitBounds = useApp((s) => s.fitBounds);
  const measurePoints = useApp((s) => s.measurePoints);
  const appReady = useApp((s) => s.ready);
  const zoneDraft = useApp((s) => s.zoneDraft);
  const fogOpacity = usePrefs((s) => s.fogOpacity);
  const zones = usePrefs((s) => s.zones);
  const theme = resolveTheme(themePref);

  // ---------------------------------------------------------------- создание карты
  useEffect(() => {
    if (!ref.current || !mapInfo || mapRef.current) return;
    registerPmtilesProtocol();
    const pos = useApp.getState().position;
    const map = new MlMap({
      container: ref.current,
      style: buildStyle({ theme, lang, tilesUrl: mapInfo.tilesUrl }),
      center: pos ? [pos.lng, pos.lat] : mapInfo.center,
      zoom: 15.5,
      minZoom: 6,
      maxZoom: 19.5,
      maxPitch: 0,
      attributionControl: false,
      fadeDuration: 150,
      dragRotate: true,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.addControl(new AttributionControl({ compact: true }), 'bottom-left');
    mapRef.current = map;
    mapApi.map = map;

    const fog = new FogRenderer(map, engine.grid, {
      getZones: () => usePrefs.getState().zones,
      getDraftZone: () => {
        const z = useApp.getState().zoneDraft;
        return z ? { id: 'draft', name: z.name || '…', lng: z.lng, lat: z.lat, radius: z.radius } : null;
      },
      getOpacity: () => usePrefs.getState().fogOpacity,
      getTheme: () => resolveTheme(usePrefs.getState().theme),
    });
    fogRef.current = fog;
    const offReveal = engine.onReveal((cells) => fog.addPulse(cells));

    map.on('style.load', () => {
      addOverlays(map);
      syncOverlays();
    });

    let rafBearing = 0;
    map.on('rotate', () => {
      if (rafBearing) return;
      rafBearing = requestAnimationFrame(() => {
        rafBearing = 0;
        const b = map.getBearing();
        if (Math.abs(b - useApp.getState().mapBearing) > 0.3) useApp.getState().patch({ mapBearing: b });
      });
    });
    map.on('dragstart', (e) => {
      if (e.originalEvent && useApp.getState().follow) useApp.getState().patch({ follow: false });
    });

    // Центр карты нужен режимам «выбрать точку» и «зона»; заодно проверяем покрытие офлайн-картой.
    let rafMove = 0;
    map.on('move', () => {
      if (rafMove) return;
      rafMove = requestAnimationFrame(() => {
        rafMove = 0;
        const c = map.getCenter();
        const st = useApp.getState();
        if (st.mode === 'pick' && st.draft) st.patch({ draft: { ...st.draft, lng: c.lng, lat: c.lat, manual: true } });
        if (st.mode === 'zone' && st.zoneDraft) st.patch({ zoneDraft: { ...st.zoneDraft, lng: c.lng, lat: c.lat } });
        const [w, s, e, n] = mapInfo.bounds;
        const missing = c.lng < w || c.lng > e || c.lat < s || c.lat > n;
        if (missing !== st.mapMissing) st.patch({ mapMissing: missing });
      });
    });

    map.on('click', (e) => {
      if (useApp.getState().mode !== 'measure') return;
      const st = useApp.getState();
      st.patch({ measurePoints: [...st.measurePoints, { lng: e.lngLat.lng, lat: e.lngLat.lat }] });
      tap('light');
    });

    map.once('idle', () => {
      setReady(true);
      ref.current?.setAttribute('data-map-ready', '1');
    });
    map.on('idle', () => ref.current?.setAttribute('data-map-idle', String(Date.now())));

    if (import.meta.env.DEV || import.meta.env.MODE === 'demo') {
      (window as unknown as { __map: MlMap; __fog: FogRenderer }).__map = map;
      (window as unknown as { __fog: FogRenderer }).__fog = fog;
    }

    return () => {
      offReveal();
      fog.destroy();
      map.remove();
      mapRef.current = null;
      mapApi.map = null;
      fogRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapInfo?.id]);

  // ---------------------------------------------------------------- смена темы / языка
  const firstStyle = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapInfo) return;
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    map.setStyle(buildStyle({ theme, lang, tilesUrl: mapInfo.tilesUrl }), { diff: false });
  }, [theme, lang, mapInfo]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0B1220' : '#F4F6FB');
  }, [theme]);

  // ---------------------------------------------------------------- оверлеи (измерение, трек)
  function syncOverlays() {
    const map = mapRef.current;
    if (!map || !map.getSource('measure-line')) return;
    const st = useApp.getState();
    const d = measureData(st.measurePoints, usePrefs.getState().units, usePrefs.getState().lang);
    (map.getSource('measure-line') as GeoJSONSource).setData(d.line);
    (map.getSource('measure-pts') as GeoJSONSource).setData(d.pts);
    const lines = engine.trackLines();
    (map.getSource('track') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: lines.map((c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} })),
    });
  }

  useEffect(() => {
    syncOverlays();
  }, [measurePoints, units, lang, ready, peek]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer('track-line')) return;
    const v = peek ? 'visible' : 'none';
    map.setLayoutProperty('track-line', 'visibility', v);
    map.setLayoutProperty('track-casing', 'visibility', v);
  }, [peek, ready]);

  // ---------------------------------------------------------------- туман
  useEffect(() => {
    fogRef.current?.setPeek(peek);
  }, [peek, ready]);
  useEffect(() => {
    fogRef.current?.requestDraw();
  }, [fogOpacity, zones, zoneDraft, appReady, ready, theme]);
  useEffect(() => useApp.subscribe((s, p) => s.stats !== p.stats && fogRef.current?.requestDraw()), []);

  // ---------------------------------------------------------------- камера
  useEffect(() => {
    if (flyTo && mapRef.current) {
      mapRef.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom ?? Math.max(mapRef.current.getZoom(), 15), duration: 900, essential: true });
    }
  }, [flyTo]);

  useEffect(() => {
    if (fitBounds && mapRef.current) {
      const [w, s, e, n] = fitBounds.bounds;
      mapRef.current.fitBounds([[w, s], [e, n]], { padding: 60, duration: 900, maxZoom: 16 });
    }
  }, [fitBounds]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position || !follow) return;
    const opts: { center: [number, number]; duration: number; bearing?: number } = { center: [position.lng, position.lat], duration: 700 };
    if (orientMap && heading !== null) opts.bearing = heading;
    map.easeTo(opts);
  }, [position, follow, orientMap, heading]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && orientMap && heading !== null && !useApp.getState().follow) map.rotateTo(heading, { duration: 300 });
  }, [orientMap, heading]);

  // ---------------------------------------------------------------- маркер игрока
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!position) {
      meRef.current?.marker.remove();
      meRef.current = null;
      return;
    }
    if (!meRef.current) {
      const el = document.createElement('div');
      el.className = 'me';
      el.innerHTML = '<div class="me-cone"></div><div class="me-pulse"></div><div class="me-dot"></div>';
      const marker = new Marker({ element: el, rotationAlignment: 'viewport', pitchAlignment: 'viewport' }).setLngLat([position.lng, position.lat]).addTo(map);
      meRef.current = { marker, cone: el.querySelector('.me-cone') as HTMLElement };
    } else {
      meRef.current.marker.setLngLat([position.lng, position.lat]);
    }
  }, [position, ready]);

  const mapBearing = useApp((s) => s.mapBearing);
  useEffect(() => {
    const me = meRef.current;
    if (!me) return;
    const h = heading ?? (position?.heading != null && (position.speed ?? 0) > 0.8 ? position.heading : null);
    me.cone.style.opacity = h === null ? '0' : '1';
    if (h !== null) me.cone.style.transform = `rotate(${h - mapBearing}deg)`;
  }, [heading, mapBearing, position]);

  // ---------------------------------------------------------------- маркеры заметок
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const have = pinsRef.current;
    const ids = new Set(notes.map((n) => n.id));
    for (const [id, p] of have) {
      if (!ids.has(id)) {
        p.marker.remove();
        have.delete(id);
      }
    }
    for (const n of notes) {
      let p = have.get(n.id);
      if (!p) {
        const el = document.createElement('div');
        el.className = 'pin-host';
        const marker = new Marker({ element: el, anchor: 'bottom', subpixelPositioning: true }).setLngLat([n.lng, n.lat]).addTo(map);
        p = { marker, el };
        have.set(n.id, p);
      } else {
        p.marker.setLngLat([n.lng, n.lat]);
      }
    }
    setPins([...have].map(([id, p]) => ({ id, el: p.el })));
  }, [notes, ready]);

  const noteById = new Map(notes.map((n) => [n.id, n]));

  return (
    <div className="map-root">
      <div ref={ref} className="map-canvas" />
      {pins.map(({ id, el }) => {
        const n = noteById.get(id);
        if (!n) return null;
        const cat = categoryById(n.category);
        return createPortal(
          <button
            className="pin"
            style={{ ['--c' as string]: cat.color }}
            aria-label={n.title}
            onClick={(e) => {
              e.stopPropagation();
              tap('light');
              const st = useApp.getState();
              if (st.mode === 'measure') st.patch({ measurePoints: [...st.measurePoints, { lng: n.lng, lat: n.lat }] });
              else st.patch({ selectedNoteId: n.id, sheet: { type: 'note', id: n.id } });
            }}
          >
            <span className="pin-body">
              <Icon name={cat.icon} size={16} strokeWidth={2.4} />
            </span>
            <span className="pin-tip" />
          </button>,
          el,
          id,
        );
      })}
    </div>
  );
}

/** Расстояние от игрока до точки (для подписей). */
export function distanceFromMe(p: LngLat): number | null {
  const me = useApp.getState().position;
  return me ? haversine(me, p) : null;
}
