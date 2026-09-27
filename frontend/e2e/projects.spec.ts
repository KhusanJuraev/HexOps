import { expect, test, type Page } from '@playwright/test'

// Must match backend/tests/e2e_server.py.
const USER = 'e2e'
const PASSWORD = 'e2e password for disposable db'
const WIDTHS = [320, 375, 768, 1024, 1440] as const

async function signIn(page: Page) {
  const res = await page.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
  expect(res.status()).toBe(200)
}

async function csrf(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
}

async function createProject(page: Page, data: Record<string, unknown>) {
  const res = await page.request.post('/api/projects', {
    headers: { 'X-CSRF-Token': await csrf(page) },
    data: { type: 'bounty_program', status: 'active', description: '', scope: [], ...data },
  })
  expect(res.status(), await res.text()).toBe(201)
  return (await res.json()) as { id: number; name: string }
}

async function expectNoHorizontalOverflow(page: Page, label: string) {
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

test('create with the keyboard; scope order and exact values survive', async ({ page }) => {
  const name = `Kbd ${Date.now()}`
  await signIn(page)
  await page.goto('/projects/new')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Type').selectOption('pentest_client')
  await page.getByLabel('Start date').fill('01/09/2026') // day first
  await page.getByLabel('Description').fill('Rules:\n- no DoS')

  const add = page.getByRole('button', { name: 'Add asset' })
  await add.focus()
  await page.keyboard.press('Enter') // new row, focus lands in its value field
  // Focus moves on the next animation frame; typing earlier would drop the first key.
  const values = page.locator('[data-scope-value]')
  await expect(values.nth(0)).toBeFocused()
  await page.keyboard.type('*.Example.com')
  await page.getByLabel('Kind').first().selectOption('wildcard')
  await add.focus()
  await page.keyboard.press('Enter')
  await expect(values.nth(1)).toBeFocused()
  await page.keyboard.type('10.20.0.0/16')
  await page.getByLabel('Kind').nth(1).selectOption('cidr')
  await page.getByLabel('Note (optional)').nth(1).fill('VPN')
  await page.getByRole('button', { name: 'Move asset 2 up' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Move asset 1 down' })).toBeVisible()

  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(page.getByText('Project created.')).toBeVisible()
  await expect(page.getByText(/Started 01\/09\/2026/)).toBeVisible() // 1 September, stored 2026-09-01
  const saved = page.getByRole('region', { name: 'Scope (2)' }).locator('code')
  await expect(saved).toHaveText(['10.20.0.0/16', '*.Example.com'])
  await expect(page.getByText('Rules:\n- no DoS')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Activity' }).getByText('Project created')).toBeVisible()

  // Reload: it came from the server, not from memory.
  await page.reload()
  await expect(page.getByRole('region', { name: 'Scope (2)' }).locator('code')).toHaveText(['10.20.0.0/16', '*.Example.com'])
})

test('invalid scope is refused with a field error, nothing is created', async ({ page }) => {
  const name = `Invalid ${Date.now()}`
  await signIn(page)
  await page.goto('/projects/new')
  await page.getByLabel('Name').fill(name)
  await page.getByRole('button', { name: 'Add asset' }).click()
  await page.getByLabel('Kind').selectOption('cidr')
  await page.getByLabel('Value').fill('10.0.0.5/24')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByText('The range must start at its network address, e.g. 10.0.0.0/24.')).toBeVisible()
  await expect(page.getByLabel('Value')).toHaveAttribute('aria-invalid', 'true')
  await expect(page).toHaveURL('/projects/new')
  const list = await page.request.get(`/api/projects?q=${encodeURIComponent(name)}`)
  expect((await list.json()).total).toBe(0)
})

test('edit status and fields; activity records both', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, { name: `Edit ${Date.now()}` })
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('link', { name: 'Edit' }).click()
  await page.getByLabel('Status').selectOption('paused')
  await page.getByLabel('Description').fill('Paused until the new scope.')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved.')).toBeVisible()
  const activity = page.getByRole('region', { name: 'Activity' })
  await expect(activity.getByText('Status changed: Active → Paused')).toBeVisible()
  await expect(activity.getByText('Updated: description')).toBeVisible()
  await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible()
})

test('server-side filters, sort and pagination; URL state survives reload and Back', async ({ page }) => {
  const prefix = `Bulk${Date.now()}`
  await signIn(page)
  for (let i = 1; i <= 25; i++) {
    await createProject(page, {
      name: `${prefix} ${String(i).padStart(2, '0')}`,
      type: i % 5 === 0 ? 'pentest_client' : 'bounty_program',
      status: i % 2 ? 'active' : 'closed',
    })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/projects')
  await page.getByLabel('Search by name').fill(prefix)
  await expect(page.getByText('1–20 of 25')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`q=${prefix}`))

  await page.getByLabel('Sort by').selectOption('name:asc')
  const firstRow = page.getByRole('table').getByRole('link').first()
  await expect(firstRow).toHaveText(`${prefix} 01`)
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('21–25 of 25')).toBeVisible()
  await expect(firstRow).toHaveText(`${prefix} 21`)

  await page.reload()
  await expect(page.getByText('21–25 of 25')).toBeVisible()
  await page.goBack()
  await expect(page.getByText('1–20 of 25')).toBeVisible()

  await page.getByLabel('Type', { exact: true }).selectOption('pentest_client')
  await expect(page.getByRole('table').getByRole('link')).toHaveText([`${prefix} 05`, `${prefix} 10`, `${prefix} 15`, `${prefix} 20`, `${prefix} 25`])
  await page.getByLabel('Status', { exact: true }).selectOption('closed')
  await expect(page.getByRole('table').getByRole('link')).toHaveText([`${prefix} 10`, `${prefix} 20`])

  await page.getByLabel('Search by name').fill(`${prefix}-nothing`)
  await expect(page.getByRole('heading', { name: 'No matching projects' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await expect(page.getByLabel('Search by name')).toHaveValue('')
})

test('delete through the confirmation dialog (Escape cancels)', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, { name: `Delete ${Date.now()}` })
  await page.goto(`/projects/${project.id}`)
  const trigger = page.getByRole('button', { name: 'Delete' })
  await trigger.click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete this project?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await dialog.getByRole('button', { name: 'Delete project' }).click()
  await expect(page).toHaveURL('/projects')
  await expect(page.getByText('Project deleted.')).toBeVisible()
  expect((await page.request.get(`/api/projects/${project.id}`)).status()).toBe(404)
})

test('projects pages fit 320–1440 px in all three languages, even with long values', async ({ page }) => {
  test.setTimeout(180_000) // 3 languages × 5 widths × 4 pages
  await signIn(page)
  const long = `https://very-long-subdomain-name-for-layout-testing.${'x'.repeat(60)}.example.com/path/${'y'.repeat(80)}`
  const project = await createProject(page, {
    name: `Layout ${'W'.repeat(80)}`,
    description: 'z'.repeat(300),
    scope: [
      { kind: 'url', value: long, note: 'n'.repeat(200) },
      { kind: 'wildcard', value: '*.example.com', note: '' },
    ],
  })
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const path of ['/projects', `/projects/${project.id}`, `/projects/${project.id}/edit`, '/projects/new']) {
        await page.goto(path)
        await expect(page.locator('main h1')).toBeVisible()
        await expectNoHorizontalOverflow(page, `${lang} ${width}px ${path}`)
      }
      if (lang !== 'en' || width === 320)
        await page.goto(`/projects/${project.id}`).then(() => page.screenshot({ path: `test-results/screens/project-${lang}-${width}.png`, fullPage: true }))
    }
  }
})

test('project routes require a session', async ({ page }) => {
  for (const path of ['/api/projects', '/api/projects/1', '/api/activity']) {
    expect((await page.request.get(path)).status()).toBe(401)
  }
  await page.goto('/projects/new')
  await expect(page).toHaveURL(/\/login/)
})
