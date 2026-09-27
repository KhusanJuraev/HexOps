import { defineConfig, devices } from '@playwright/test'

// Browser tests run against their own servers: the API on a wiped, disposable
// database (backend/tests/e2e_server.py) and a Vite dev server proxying to it.
// Neither touches the dev database or the default ports.
// HEXOPS_E2E_PREVIEW=1 serves the production build (`npm run build` first) with
// `vite preview` instead of the dev server, on the same port and proxy (D-82).
const PREVIEW = process.env.HEXOPS_E2E_PREVIEW === '1'
const API_PORT = 8001
const UI_PORT = 5174
const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Full Chromium ("new headless"), not the stripped chrome-headless-shell: the shell's
    // compositor hit a CHECK (trap int3) after ~60 navigations in long layout runs (D-80).
    { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
  webServer: [
    {
      command: `${python} -m tests.e2e_server`,
      cwd: '../backend',
      env: { HEXOPS_E2E_API_PORT: String(API_PORT) },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: PREVIEW ? `npx vite preview --port ${UI_PORT}` : `npx vite --port ${UI_PORT}`,
      env: { HEXOPS_API_URL: `http://127.0.0.1:${API_PORT}` },
      url: `http://127.0.0.1:${UI_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
