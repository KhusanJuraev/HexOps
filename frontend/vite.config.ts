/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The dev server binds to loopback by default. The API is proxied so the browser sees
// a single origin, which keeps the SameSite=Strict session cookie working; the API
// itself can stay on loopback even when the UI is shared on the LAN.
const apiTarget = process.env.HEXOPS_API_URL ?? 'http://127.0.0.1:8000'

// LAN exposure is an explicit choice, as on the backend (D-11): a non-loopback
// HEXOPS_UI_HOST is refused unless HEXOPS_ALLOW_LAN=true.
const uiHost = process.env.HEXOPS_UI_HOST ?? '127.0.0.1'
const isLoopback = uiHost === 'localhost' || uiHost === '::1' || uiHost.startsWith('127.')
if (!isLoopback && process.env.HEXOPS_ALLOW_LAN !== 'true') {
  throw new Error(
    `HEXOPS_UI_HOST=${uiHost} is not a loopback address. ` +
      'Set HEXOPS_ALLOW_LAN=true to expose the HexOps UI on the network explicitly.',
  )
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: uiHost,
    // Extra Host names Vite answers to, e.g. the name a local HTTPS reverse proxy
    // forwards (README "LAN access over HTTPS"). Unknown hosts are rejected (DNS rebinding).
    allowedHosts: process.env.HEXOPS_UI_ALLOWED_HOSTS?.split(',').map((h) => h.trim()).filter(Boolean),
    port: 5173,
    strictPort: true,
    // xfwd: pass the real client address on, so loopback-only endpoints (first-run
    // setup) can tell a LAN browser from a local one behind this proxy.
    proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
  // The production build served locally (E2E against preview, D-82): always loopback,
  // with the same /api proxy as the dev server.
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } },
  },
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Browser tests in e2e/ run under Playwright (npm run e2e), not Vitest.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
