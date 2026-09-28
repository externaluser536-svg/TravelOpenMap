import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' — приложение грузится из локального файлового/https://localhost контекста Capacitor.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
