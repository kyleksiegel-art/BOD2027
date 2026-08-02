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
  build: {
    // Hashed, content-addressed output lives under /_assets/ so netlify.toml can
    // cache it immutably, while stable public files at /assets/ keep their own
    // (shorter) caching policy.
    assetsDir: '_assets',
  },
})
