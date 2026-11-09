import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `HTTPS=1 pnpm dev` serves https on the LAN: required to test the camera on an iPhone
const https = process.env.HTTPS === '1';
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [
    react(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CardVault – Biglietti da visita',
        short_name: 'CardVault',
        description: 'Scansiona, archivia e cerca i biglietti da visita. OCR sul dispositivo.',
        lang: 'it',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f9f9fb',
        theme_color: '#0c4577',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['ocr/**'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // OCR engine + models (~12 MB): cached on first use, then offline
            urlPattern: ({ url }) => url.pathname.startsWith('/ocr/'),
            handler: 'CacheFirst',
            options: { cacheName: 'cardvault-ocr', expiration: { maxEntries: 10 } },
          },
        ],
      },
    }),
  ],
  server: {
    host: https ? '0.0.0.0' : 'localhost',
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  preview: { port: 4173, proxy: { '/api': { target: apiTarget } } },
  build: { target: 'es2022', sourcemap: true },
  worker: { format: 'es' },
});
