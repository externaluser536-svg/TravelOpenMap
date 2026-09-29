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
import { FogEditTooLargeError, cellsInCircle, cellsInPolygon, type FogEditAction } from '../core/fogedit';
import { formatArea } from '../core/geo';

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

/** Новая заметка в произвольной точке карты (с фото и видео, как обычная). */
export function startNoteAt(at: { lng: number; lat: number }): void {
  const draft: NoteDraft = { title: '', text: '', category: 'place', lng: at.lng, lat: at.lat, media: [], removedMediaIds: [], manual: true };
  tap('medium');
  useApp.getState().patch({ draft, sheet: { type: 'editor' }, mode: 'normal', mapMenu: null });
}

export function startMeasureAt(at: { lng: number; lat: number }): void {
  tap('light');
  useApp.getState().patch({ mode: 'measure', measurePoints: [{ lng: at.lng, lat: at.lat }], sheet: null, screen: 'map', mapMenu: null });
}

/** Включает режим ручной правки тумана. Без точки берёт центр карты. */
export function startFogEdit(action: FogEditAction, at?: { lng: number; lat: number }): void {
  const st = useApp.getState();
  const c = at ?? mapApi.fogPoint() ?? st.position ?? { lng: 0, lat: 0 };
  tap('light');
  st.patch({
    mode: 'fogedit',
    fogDraft: { action, tool: 'circle', lng: c.lng, lat: c.lat, radius: 250, poly: [] },
    sheet: null,
    screen: 'map',
    follow: false,
    peek: false,
    mapMenu: null,
    measurePoints: [],
    ...(at ? { flyTo: { lng: c.lng, lat: c.lat, zoom: Math.max(mapApi.zoom(), 15.5), nonce: Date.now() } } : {}),
  });
}

/** Применяет текущее выделение. Возвращает число изменённых ячеек или null, если область не выбрана/слишком велика. */
export function applyFogDraft(): number | null {
  const st = useApp.getState();
  const d = st.fogDraft;
  if (!d) return null;
  let keys: number[];
  try {
    keys = d.tool === 'circle' ? cellsInCircle({ lng: d.lng, lat: d.lat }, d.radius) : cellsInPolygon(d.poly);
  } catch (e) {
    if (e instanceof FogEditTooLargeError) {
      st.toast({ kind: 'error', title: t('fogedit.too_big'), icon: 'triangle-alert' });
      return null;
    }
    throw e;
  }
  if (!keys.length) {
    st.toast({ kind: 'info', title: t(d.tool === 'area' ? 'fogedit.need_points' : 'fogedit.nothing'), icon: 'info' });
    return null;
  }
  const r = engine.editFog(d.action, keys);
  tap('medium');
  const { units, lang } = usePrefs.getState();
  st.patch({ fogDraft: { ...d, poly: d.tool === 'area' ? [] : d.poly } });
  st.toast({
    kind: 'info',
    icon: d.action === 'open' ? 'cloud-off' : 'cloud',
    title: r.changed
      ? t(d.action === 'open' ? 'fogedit.done_open' : 'fogedit.done_close', { area: formatArea(r.areaM2, units, lang) })
      : t('fogedit.nothing_changed'),
  });
  return r.changed;
}

export function undoFogEdit(): void {
  const n = engine.undoFogEdit();
  if (n) {
    tap('light');
    useApp.getState().toast({ kind: 'info', icon: 'undo', title: t('fogedit.undone') });
  }
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
  else if (st.mode === 'fogedit') st.patch({ mode: 'normal', fogDraft: null });
  else st.patch({ mode: 'normal', measurePoints: [] });
}

/** Делает карту активной и показывает её область. */
export async function activateMap(id: string): Promise<void> {
  const info = await openMap(id);
  if (!info) return;
  usePrefs.getState().set({ activeMapId: id });
  useApp.getState().patch({ mapInfo: info, fitBounds: { bounds: info.bounds, nonce: Date.now() } });
}
