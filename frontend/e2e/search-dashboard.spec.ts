import { expect, test, type Page } from '@playwright/test'

import { apiCall, createNote, createProject, createReport, expectNoHorizontalOverflow, signIn } from './helpers.ts'

async function paidReport(page: Page, projectId: number, amount: string, currency: string) {
  const r = await createReport(page, projectId, { type: 'bbp', severity: 'high', bounty_amount: amount, bounty_currency: currency })
  for (const to of ['submitted', 'triaged', 'accepted', 'paid']) {
    expect((await apiCall(page, 'POST', `/api/reports/${r.id}/status`, { to })).status()).toBe(200)
  }
  return r
}

test('search in the UI: languages, identifiers, highlighting, filters, pagination', async ({ page }) => {
  await signIn(page)
  const tag = `s${Date.now()}`
  const project = await createProject(page, `Search ${tag}`)
  const report = await createReport(page, project.id, { title: `Exploits ${tag}`, body_md: 'Multiple exploits against api.target-example.com and CVE-2024-12345.' })
  const ru = await createNote(page, { title: `Разведка ${tag}`, body_md: 'Найдены уязвимости на 10.20.30.40', tags: [tag] })
  const uz = await createNote(page, { title: `Koʻrinish ${tag}`, body_md: 'Tizim oʻzbek tilida', tags: [tag] })

  await page.goto('/search')
  await expect(page.getByRole('heading', { name: 'Search your workspace' })).toBeVisible()
  const box = page.getByLabel('Search for')
  const expectHits = async (q: string, hrefs: string[]) => {
    await box.fill(q)
    for (const href of hrefs) await expect(page.locator(`main a[href="${href}"]`)).toBeVisible()
  }
  await expectHits(`exploit ${tag}`, [`/reports/${report.id}`])
  await expectHits(`уязвимость ${tag}`, [`/notes/${ru.id}`])
  await expectHits(`korinish ${tag}`, [`/notes/${uz.id}`])
  await expectHits('CVE-2024-12345', [`/reports/${report.id}`])
  await expectHits('target-example.com', [`/reports/${report.id}`])
  await expectHits('10.20.30.40', [`/notes/${ru.id}`])
  await expect(page.locator('main mark').first()).toHaveText('10.20.30.40')

  await box.fill(tag)
  await expect(page.getByText('Results: 3')).toBeVisible()
  await page.getByLabel('Look in').selectOption('note')
  await expect(page.getByText('Results: 2')).toBeVisible()
  await page.getByLabel('Note tag').selectOption(tag)
  await expect(page).toHaveURL(new RegExp(`kind=note&tag=${tag}`))
  await page.reload()
  await expect(page.getByText('Results: 2')).toBeVisible()
  await expect(page.getByLabel('Search for')).toHaveValue(tag)
})

test('search pages through many results on the server', async ({ page }) => {
  await signIn(page)
  const word = `pagex${Date.now()}`
  for (let i = 0; i < 25; i++) await createNote(page, { title: `${word} ${i}` })
  const seen = new Set<string>()
  for (const p of [1, 2]) {
    const res = await page.request.get(`/api/search?q=${word}&size=20&page=${p}`)
    const body = await res.json()
    expect(body.total).toBe(25)
    for (const h of body.items) seen.add(`${h.kind}-${h.id}`)
  }
  expect(seen.size).toBe(25)
  await page.goto(`/search?q=${word}`)
  await expect(page.getByText('1–20 of 25')).toBeVisible()
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('21–25 of 25')).toBeVisible()
})

test('dashboard numbers match the API; currencies stay apart', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  const project = await createProject(page, `Dash ${Date.now()}`)
  await paidReport(page, project.id, '100.50', 'USD')
  await paidReport(page, project.id, '40.00', 'EUR')
  const [summary, severity, bounties] = await Promise.all(
    ['summary', 'severity', 'bounties'].map(async (n) => (await page.request.get(`/api/dashboard/${n}`)).json()),
  )
  await page.goto('/')
  const overview = page.getByRole('region', { name: 'Overview' })
  await expect(overview.getByRole('link', { name: String(summary.active_projects), exact: true })).toBeVisible()
  await expect(overview.getByRole('link', { name: String(summary.reports), exact: true })).toBeVisible()

  const sev = page.getByRole('region', { name: 'Findings by severity' })
  await expect(sev.getByRole('img')).toHaveAttribute('aria-label', new RegExp(`${severity.total} in total`))
  await expect(sev.locator('svg .recharts-bar-rectangle').first()).toBeVisible() // bars are drawn
  await sev.getByText('Show data as a table').focus()
  await page.keyboard.press('Enter')
  await expect(sev.getByRole('row', { name: new RegExp(`High ${severity.counts.high}$`) })).toBeVisible()

  const money = page.getByRole('region', { name: 'Bounty earnings' })
  for (const c of bounties.currencies as { currency: string; total: string }[]) {
    await expect(money.locator(`[data-currency="${c.currency}"]`)).toBeVisible()
  }
  expect((bounties.currencies as { currency: string }[]).map((c) => c.currency)).toEqual(expect.arrayContaining(['EUR', 'USD']))
  await expect(money.getByText('Each currency is shown on its own; amounts in different currencies are never added together.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recent activity' }).getByText('Status changed: Accepted → Paid').first()).toBeVisible()
})

test('bounty earnings match the database; unpaid amounts are apart; a correction moves them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  // A currency code no other test uses, so the totals below belong to this test only.
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const cur = `Q${L[Date.now() % 26]}${L[Math.floor(Date.now() / 26) % 26]}`
  const project = await createProject(page, `Bounty ${cur} ${Date.now()}`)
  const paid = await paidReport(page, project.id, '1234.56', cur)
  await createReport(page, project.id, { type: 'bbp', severity: 'low', bounty_amount: '100.00', bounty_currency: cur }) // draft

  const api = await (await page.request.get('/api/dashboard/bounties')).json()
  const earned = api.currencies.find((c: { currency: string }) => c.currency === cur)
  const pending = api.unpaid.find((c: { currency: string }) => c.currency === cur)
  expect([earned.total, earned.count, pending.total, pending.count]).toEqual(['1234.56', 1, '100.00', 1])

  await page.goto('/')
  const money = page.getByRole('region', { name: 'Bounty earnings' })
  await expect(money.locator(`[data-currency="${cur}"] p.text-lg`)).toHaveText(/1,234\.56/)
  await expect(money.locator(`[data-currency="${cur}"]`)).toContainText('Paid reports: 1')
  await expect(money.getByText('Recorded, not marked Paid')).toBeVisible()
  await expect(money.locator(`[data-unpaid-currency="${cur}"]`)).toContainText('100.00')
  await expect(money.locator(`[data-unpaid-currency="${cur}"]`)).toContainText('Reports: 1')

  // Undo Paid in the UI: the amount leaves earnings and joins the unpaid amounts.
  await page.goto(`/reports/${paid.id}`)
  const status = page.getByRole('region', { name: 'Status' })
  await status.getByRole('button', { name: 'Undo: back to Accepted' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo: back to Accepted' }).click()
  await expect(status.getByRole('button', { name: 'Mark as Paid' })).toBeVisible()
  await page.goto('/')
  await expect(money.locator(`[data-unpaid-currency="${cur}"]`)).toContainText('1,334.56')
  await expect(money.locator(`[data-unpaid-currency="${cur}"]`)).toContainText('Reports: 2')
  await expect(money.locator(`[data-currency="${cur}"]`)).toHaveCount(0)
})

test('one failing widget leaves the others working', async ({ page }) => {
  await signIn(page)
  await page.route('**/api/dashboard/severity', (r) => r.fulfill({ status: 500, body: '{"detail":"x","code":"internal_error"}', contentType: 'application/json' }))
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Findings by severity' }).getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Reports by status' }).getByRole('img')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Overview' }).getByRole('link').first()).toBeVisible()
})

test('empty data shows empty states, never sample figures', async ({ page }) => {
  await signIn(page)
  const zeros = (keys: string[]) => ({ counts: Object.fromEntries(keys.map((k) => [k, 0])), total: 0 })
  const fake: Record<string, unknown> = {
    severity: zeros(['critical', 'high', 'medium', 'low', 'info']),
    status: zeros(['draft', 'submitted', 'triaged', 'accepted', 'duplicate', 'rejected', 'paid']),
    timeline: { months: [{ month: '2026-09', count: 0 }], total: 0 },
    bounties: { currencies: [], unpriced_paid: 0, unpaid: [] },
  }
  await page.route('**/api/dashboard/*', (r) => {
    const name = new URL(r.request().url()).pathname.split('/').pop()!
    return name in fake ? r.fulfill({ json: fake[name] }) : r.fallback()
  })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Findings by severity' }).getByText('No reports yet.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Findings over time' }).getByText('No reports were created in this period.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Bounty earnings' }).getByText('No paid bounties in this period.')).toBeVisible()
  await expect(page.locator('main svg .recharts-bar-rectangle')).toHaveCount(0)
})

test('dashboard and search fit 320–1440 px in all three languages', async ({ page }) => {
  test.setTimeout(180_000)
  await signIn(page)
  const project = await createProject(page, `Wide ${'W'.repeat(60)}`)
  await paidReport(page, project.id, '123456789.99', 'JPY')
  await createNote(page, { title: `Hit ${'L'.repeat(80)}`, body_md: `needle ${'z'.repeat(400)}` })
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of [320, 375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('main [data-currency]').first()).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${width}px dashboard`)
      await page.goto('/search?q=needle')
      await expect(page.locator('main ol li').first()).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${width}px search`)
      if (lang !== 'en' && (width === 375 || width === 1440)) {
        await page.goto('/')
        await expect(page.locator('main [data-currency]').first()).toBeVisible()
        await page.screenshot({ path: `test-results/screens/dashboard-${lang}-${width}.png`, fullPage: true })
      }
    }
  }
})

test('dashboard and search APIs require a session', async ({ page }) => {
  for (const path of ['/api/search?q=x', '/api/dashboard/summary', '/api/dashboard/severity', '/api/dashboard/status', '/api/dashboard/timeline', '/api/dashboard/bounties']) {
    expect((await page.request.get(path)).status(), path).toBe(401)
  }
})
