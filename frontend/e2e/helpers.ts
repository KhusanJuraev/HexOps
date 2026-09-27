import { expect, type Page } from '@playwright/test'

// Must match backend/tests/e2e_server.py.
export const USER = 'e2e'
export const PASSWORD = 'e2e password for disposable db'
export const WIDTHS = [320, 375, 768, 1024, 1440] as const

export async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
  expect(res.status()).toBe(200)
}

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
}

/** JSON API call with the CSRF header, as the app itself would send it. */
export async function apiCall(page: Page, method: 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  return page.request.fetch(path, { method, data, headers: { 'X-CSRF-Token': await csrf(page) } })
}

export async function createProject(page: Page, name: string) {
  const res = await apiCall(page, 'POST', '/api/projects', { name, type: 'bounty_program' })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: number }
}

export async function createReport(page: Page, projectId: number, data: Record<string, unknown> = {}) {
  const res = await apiCall(page, 'POST', '/api/reports', {
    project_id: projectId,
    title: 'Report',
    type: 'bbp',
    severity: 'medium',
    ...data,
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: number; title: string }
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const o = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`),
  }))
  expect(o.scroll, `${label}: ${o.offenders.join(', ')}`).toBeLessThanOrEqual(o.width)
}

export async function createNote(page: Page, data: Record<string, unknown>) {
  const res = await apiCall(page, 'POST', '/api/notes', { title: 'Note', body_md: '', tags: [], ...data })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: number }
}
