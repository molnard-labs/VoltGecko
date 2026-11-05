import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP } from './src/config';
import enApp from './src/locales/en-app';
import { resolveReleaseMetadata } from './scripts/release-info.mjs';
const manifest = {
  name: APP.name,
  short_name: APP.name,
  description: 'Offline alaprajz- és elosztótervező',
  lang: 'hu',
  theme_color: '#030b1b',
  background_color: '#030b1b',
  display: 'standalone' as const,
  start_url: '/',
  icons: [
    { src: '/brand/voltgecko-cyberpunk-icon.png', sizes: '1254x1254', type: 'image/png', purpose: 'any' as const }
  ]
};
export default defineConfig(({ command }) => ({
  define: { __VOLTGECKO_RELEASE__: JSON.stringify(resolveReleaseMetadata({ production: command === 'build' })) },
  plugins: [
    react(),
    {
      name: 'app-title',
      transformIndexHtml: (html) => html.replace(/<title>[^<]*<\/title>/, `<title>${APP.name}</title>`),
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'manifest-en.webmanifest',
          source: JSON.stringify({
            ...manifest,
            name: enApp[APP.name] ?? APP.name,
            short_name: enApp[APP.name] ?? APP.name,
            description: 'Offline electrical floor-plan and distribution-board planner',
            lang: 'en'
          })
        });
      }
    },
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['brand/*.png', 'fonts/*'],
      manifest,
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,ttf,pfb,otf,woff,woff2,bcmap,wasm,webmanifest}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html'
      }
    })
  ],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        // PDF export alone needs the server renderer. Keep it separate from
        // jsPDF without pulling React's shared runtime out of the app entry.
        manualChunks(id) {
          if (/\/node_modules\/react-dom\/.*server/.test(id.replaceAll('\\', '/'))) return 'react-dom-server';
          if (/\/node_modules\/dexie\//.test(id.replaceAll('\\', '/'))) return 'dexie';
        }
      }
    }
  }
}));
