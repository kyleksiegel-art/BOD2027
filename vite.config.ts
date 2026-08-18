/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
