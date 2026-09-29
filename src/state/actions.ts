// Действия интерфейса, затрагивающие несколько частей состояния.

import { useApp, type DraftMedia, type NoteDraft } from './store';
import { usePrefs } from './prefs';
import { engine } from './engine';
import { getMediaForNote, uid } from '../data/db';
import { mapApi } from '../map/MapView';
import { openMap } from '../map/maps';
import { startLocation } from '../services/location';
import { startCompass } from '../services/compass';
import { tap } from '../services/haptics';
import { t } from '../i18n';
import type { ExclusionZone } from '../core/fog';

export function startNote(): void {
  const st = useApp.getState();
  const at = st.position ?? mapApi.center() ?? { lng: st.mapInfo?.center[0] ?? 0, lat: st.mapInfo?.center[1] ?? 0 };
  const draft: NoteDraft = {
    title: '',
    text: '',
    category: 'place',
    lng: at.lng,
    lat: at.lat,
    media: [],
    removedMediaIds: [],
    manual: false,
  };
  tap('medium');
  st.patch({ draft, sheet: { type: 'editor' }, mode: 'normal' });
}

export async function editNote(id: string): Promise<void> {
  const note = useApp.getState().notes.find((n) => n.id === id);
  if (!note) return;
  const recs = await getMediaForNote(id);
  const media: DraftMedia[] = recs.map((r) => ({
    key: r.id,
    existingId: r.id,
    kind: r.kind,
    blob: r.blob,
    thumb: r.thumb,
    mime: r.mime,
    width: r.width,
    height: r.height,
  }));
  useApp.getState().patch({
    draft: { id: note.id, title: note.title, text: note.text, category: note.category, lng: note.lng, lat: note.lat, media, removedMediaIds: [], manual: true },
    sheet: { type: 'editor' },
  });
}

export function toggleMeasure(): void {
  const st = useApp.getState();
  tap('light');
  if (st.mode === 'measure') st.patch({ mode: 'normal', measurePoints: [] });
  else st.patch({ mode: 'measure', measurePoints: [], sheet: null, screen: 'map' });
}

export function togglePeek(): void {
  const st = useApp.getState();
  tap('light');
  st.patch({ peek: !st.peek });
}

export function locateMe(): void {
  const st = useApp.getState();
  tap('light');
  if (st.gps === 'off' || st.gps === 'denied' || st.gps === 'unavailable') void startLocation();
  if (st.position) st.patch({ follow: true, flyTo: { lng: st.position.lng, lat: st.position.lat, zoom: Math.max(mapApi.zoom(), 16), nonce: Date.now() } });
  else st.patch({ follow: true });
}

export function toggleOrient(): void {
  const st = useApp.getState();
  tap('light');
  void startCompass(true);
  if (st.orientMap) {
    st.patch({ orientMap: false });
    mapApi.resetNorth();
  } else st.patch({ orientMap: true });
}

export function startZoneEditor(existing?: ExclusionZone): void {
  const st = useApp.getState();
  const at = existing ?? st.position ?? mapApi.center() ?? { lng: 0, lat: 0 };
  st.patch({
    zoneDraft: {
      id: existing?.id,
      name: existing?.name ?? t('zones.default_name'),
      lng: at.lng,
      lat: at.lat,
      radius: existing?.radius ?? 300,
    },
    mode: 'zone',
    sheet: null,
    screen: 'map',
    follow: false,
    flyTo: { lng: at.lng, lat: at.lat, zoom: 15, nonce: Date.now() },
  });
}

export function saveZoneDraft(): void {
  const st = useApp.getState();
  const d = st.zoneDraft;
  if (!d) return;
  const zones = usePrefs.getState().zones;
  const zone: ExclusionZone = { id: d.id ?? uid(), name: d.name.trim() || t('zones.default_name'), lng: d.lng, lat: d.lat, radius: d.radius };
  engine.setZones(d.id ? zones.map((z) => (z.id === d.id ? zone : z)) : [...zones, zone]);
  st.patch({ zoneDraft: null, mode: 'normal', sheet: { type: 'zones' } });
  st.toast({ kind: 'info', title: t('zones.saved'), icon: 'shield-check' });
}

export function cancelMode(): void {
  const st = useApp.getState();
  if (st.mode === 'pick') st.patch({ mode: 'normal', sheet: { type: 'editor' } });
  else if (st.mode === 'zone') st.patch({ mode: 'normal', zoneDraft: null, sheet: { type: 'zones' } });
  else st.patch({ mode: 'normal', measurePoints: [] });
}

/** Делает карту активной и показывает её область. */
export async function activateMap(id: string): Promise<void> {
  const info = await openMap(id);
  if (!info) return;
  usePrefs.getState().set({ activeMapId: id });
  useApp.getState().patch({ mapInfo: info, fitBounds: { bounds: info.bounds, nonce: Date.now() } });
}
