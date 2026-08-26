import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The GitHub Pages web build is served from https://<user>.github.io/hr-monitor/,
// so its assets need the '/hr-monitor/' base path. The Capacitor Android build
// is packaged into the app and served by the WebView from https://localhost/ at
// the webDir root, so an absolute '/hr-monitor/' base 404s there (blank white
// screen - Capacitor logs "Unable to open asset URL: https://localhost/hr-monitor/...").
// `npm run build:android` (used by android:sync) passes --mode capacitor to get
// the relative base instead; plain `npm run build` (used by the Pages workflow)
// is untouched.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
  },
  base: mode === 'capacitor' ? './' : '/hr-monitor/',
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    setupFiles: ['./vitest.setup.js'],
  },
}));
