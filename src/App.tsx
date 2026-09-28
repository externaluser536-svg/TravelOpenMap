import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { useApp } from './state/store';
import { usePrefs, resolveTheme } from './state/prefs';
import { engine } from './state/engine';
import { MapView } from './map/MapView';
import { openMap, loadCatalog } from './map/maps';
import { Hud } from './ui/Hud';
import { TabBar } from './ui/TabBar';
import { NotesPage } from './ui/pages/NotesPage';
import { QuestsPage } from './ui/pages/QuestsPage';
import { ProfilePage } from './ui/pages/ProfilePage';
import { EditorSheet } from './ui/sheets/EditorSheet';
import { NoteSheet } from './ui/sheets/NoteSheet';
import { CompassSheet } from './ui/sheets/CompassSheet';
import { SettingsSheet } from './ui/sheets/SettingsSheet';
import { MapsSheet } from './ui/sheets/MapsSheet';
import { ZonesSheet } from './ui/sheets/ZonesSheet';
import { DataSheet } from './ui/sheets/DataSheet';
import { PrivacySheet } from './ui/sheets/PrivacySheet';
import { LevelUp, Onboarding, Toasts } from './ui/Overlays';
import { startLocation } from './services/location';
import { startCompass } from './services/compass';
import { cancelMode } from './state/actions';

export default function App() {
  const screen = useApp((s) => s.screen);
  const sheet = useApp((s) => s.sheet);
  const mapInfo = useApp((s) => s.mapInfo);
  const onboarded = usePrefs((s) => s.onboarded);
  const lang = usePrefs((s) => s.lang);
  const themePref = usePrefs((s) => s.theme);

  // ---- запуск: БД → карта → геолокация
  useEffect(() => {
    void (async () => {
      await engine.init();
      const prefs = usePrefs.getState();
      let info = await openMap(prefs.activeMapId);
      if (!info) {
        const first = (await loadCatalog())[0];
        if (first) {
          info = await openMap(first.id);
          prefs.set({ activeMapId: first.id });
        }
      }
      if (info) useApp.getState().patch({ mapInfo: info });
      if (usePrefs.getState().onboarded && !import.meta.env.MODE.includes('demo')) {
        void startLocation();
        void startCompass(false);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // ---- статус-бар и кнопка «Назад» на Android
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const dark = resolveTheme(themePref) === 'dark';
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
  }, [themePref]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const h = CapApp.addListener('backButton', () => {
      const st = useApp.getState();
      if (st.levelUp) st.patch({ levelUp: null });
      else if (st.sheet) st.patch({ sheet: null });
      else if (st.mode !== 'normal') cancelMode();
      else if (st.screen !== 'map') st.patch({ screen: 'map' });
      else void CapApp.exitApp();
    });
    return () => void h.then((x) => x.remove());
  }, []);

  return (
    <div className="app">
      <MapView />
      {screen === 'map' && mapInfo && <Hud />}
      {screen === 'map' && !mapInfo && (
        <div className="no-map glass">
          <b>Загрузка карты…</b>
        </div>
      )}
      {screen !== 'map' && (
        <div className="page-layer" key={screen}>
          {screen === 'notes' && <NotesPage />}
          {screen === 'quests' && <QuestsPage />}
          {screen === 'profile' && <ProfilePage />}
        </div>
      )}
      <TabBar />
      {sheet?.type === 'editor' && <EditorSheet />}
      {sheet?.type === 'note' && <NoteSheet id={sheet.id} />}
      {sheet?.type === 'compass' && <CompassSheet />}
      {sheet?.type === 'settings' && <SettingsSheet />}
      {sheet?.type === 'maps' && <MapsSheet />}
      {sheet?.type === 'zones' && <ZonesSheet />}
      {sheet?.type === 'data' && <DataSheet />}
      {sheet?.type === 'privacy' && <PrivacySheet />}
      <Toasts />
      <LevelUp />
      {!onboarded && <Onboarding />}
    </div>
  );
}
