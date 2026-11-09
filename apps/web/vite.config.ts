import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// `HTTPS=1 pnpm dev` serves https on the LAN: required to test the camera on an iPhone
const https = process.env.HTTPS === '1';
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

/**
 * Same policy as deploy/nginx: everything self-hosted. 'wasm-unsafe-eval' lets the
 * Tesseract worker compile its WebAssembly; style attributes are used by React.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

export default defineConfig({
  plugins: [
    react(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'theme.js'],
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
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        // dev only: from a phone on the LAN the Origin is https://<pc-ip>:5173, which the API's
        // CSRF origin check would reject; the proxy is same-origin for the browser anyway
        configure: (proxy) => proxy.on('proxyReq', (req) => req.removeHeader('origin')),
      },
    },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: apiTarget } },
    headers: { 'Content-Security-Policy': CSP },
  },
  // no data: URIs (fonts would violate font-src 'self')
  build: { target: 'es2022', sourcemap: true, assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
