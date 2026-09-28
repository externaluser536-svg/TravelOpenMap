import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.travelopenmap',
  appName: 'TravelOpenMap',
  webDir: 'dist',
  // Никаких удалённых серверов: приложение целиком лежит на устройстве.
  server: { androidScheme: 'https', cleartext: false, allowNavigation: [] },
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 600, backgroundColor: '#0B1220' },
    StatusBar: { style: 'DARK', overlaysWebView: true },
  },
};

export default config;
