/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // The service worker (docs/spec/decisions.md §"Service worker").
    //
    //  · registerType: 'prompt' — NEVER skipWaiting/clientsClaim. A silent reload mid-round
    //    could interrupt a flush and strand a score; the new version waits behind an
    //    explicit tap (PwaUpdatePrompt, suppressed while the outbox is non-empty).
    //  · globPatterns / maximumFileSizeToCacheInBytes are set explicitly (the brief) rather
    //    than left to Workbox's defaults — the hero photo is ~360 KB and the default 2 MiB
    //    cap would silently drop anything larger, so the app must state what it precaches.
    VitePWA({
      registerType: 'prompt',
      // We drive registration and the update prompt from React (useRegisterSW), so the
      // plugin must not also inject its own auto-register script.
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png'],
      workbox: {
        // Everything the SPA needs to boot and score with no network: the shell, the JS/CSS,
        // the fonts, the icons, and the hero. Content-addressed build output lives under
        // _assets/ (see build.assetsDir); stable public files under assets/.
        // avif/webp cover the responsive hero variants; the browser precaches every variant
        // so the one it picks for this device is available offline.
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,jpg,avif,webp,ico,webmanifest}'],
        // Room for the hero photo; nothing we ship approaches this.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The SPA fallback: any navigation not in the precache resolves to the app shell,
        // so a deep link (/rounds/3) opened offline still boots React.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Board of Directors — Streamsong 2027',
        short_name: 'BOD·27',
        description:
          'Live scoring, standings, and money for four rounds at Streamsong Resort, Feb 4–7 2027.',
        theme_color: '#0c1013',
        background_color: '#0c1013',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Dexie needs an IndexedDB; src/test/setup.ts supplies one (and a localStorage).
    setupFiles: ['./src/test/setup.ts'],
    // src/lib/supabase.ts throws without these. The sync tests never reach the network —
    // the transport is stubbed — but the module is imported, so the client is constructed.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
  build: {
    // Hashed, content-addressed output lives under /_assets/ so netlify.toml can
    // cache it immutably, while stable public files at /assets/ keep their own
    // (shorter) caching policy.
    assetsDir: '_assets',
  },
})
