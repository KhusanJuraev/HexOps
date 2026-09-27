import { expect, test, type Page } from '@playwright/test'

import { apiCall, createNote, createProject, createReport, expectNoHorizontalOverflow, signIn } from './helpers.ts'

/** D-89: every visible date is DD/MM/YYYY (time HH:mm, 24-hour); the API keeps ISO/UTC. */

const MONTH_WORDS =
  /\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.? \d|\b\d{1,2}-(yan|fev|mar|apr|may|iyn|iyl|avg|sen|okt|noy|dek)\b|\b(янв|февр?|мар|апр|мая|июн|июл|авг|сент?|окт|нояб?|дек)\w*\.? \d{4}|\b[AP]M\b/
const ISO_DAY = /\b\d{4}-\d{2}-\d{2}\b/

async function uniqueCurrency() {
  const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const n = Date.now()
  return `X${L[n % 26]}${L[Math.floor(n / 26) % 26]}`
}

/** A BBP report accepted before `before` (the server keeps step dates in order). */
async function acceptedBbp(page: Page, currency: string, before: string, amount = '100.00') {
  const project = await createProject(page, `Dates ${Date.now()}`)
  const report = await createReport(page, project.id, { type: 'bbp', severity: 'high', title: `Pay ${currency}`, bounty_amount: amount, bounty_currency: currency })
  const day = new Date(`${before}T00:00:00Z`).getTime()
  for (const [i, to] of ['submitted', 'triaged', 'accepted'].entries()) {
    const at = new Date(day - (3 - i) * 86_400_000).toISOString()
    expect((await apiCall(page, 'POST', `/api/reports/${report.id}/status`, { to, at })).status()).toBe(200)
  }
  return report
}

async function markPaid(page: Page, reportId: number, day: string, time: string) {
  await page.goto(`/reports/${reportId}`)
  const status = page.getByRole('region', { name: 'Status' })
  await status.getByLabel('Date', { exact: true }).fill(day)
  await status.getByLabel('Time', { exact: true }).fill(time)
  await status.getByRole('button', { name: 'Mark as Paid' }).click()
  await expect(page.getByText('Status changed to Paid.').first()).toBeVisible()
}

test.describe('Tashkent (UTC+5)', () => {
  test.use({ timezoneId: 'Asia/Tashkent' })

  test('a payment date typed day first is saved as that local moment and shown the same after reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await signIn(page)
    const cur = await uniqueCurrency()
    const report = await acceptedBbp(page, cur, '2026-06-01', '100000.00')
    await markPaid(page, report.id, '05/06/2026', '10:00')

    // API: UTC. 10:00 in Tashkent on 5 June = 05:00 UTC the same day.
    const saved = await (await page.request.get(`/api/reports/${report.id}`)).json()
    // The API may write the instant with the server's offset; compare instants, not text.
    expect(new Date(saved.paid_at).toISOString()).toBe('2026-06-05T05:00:00.000Z')
    const timeline = page.getByRole('region', { name: 'Timeline' })
    await expect(timeline.getByText('05/06/2026 10:00')).toBeVisible()
    await page.reload()
    await expect(timeline.getByText('05/06/2026 10:00')).toBeVisible() // no shift on reload

    // Dashboard: the June bucket of this currency holds the amount.
    await page.goto('/')
    const money = page.getByRole('region', { name: 'Bounty earnings' }).locator(`[data-currency="${cur}"]`)
    await money.getByText('Show data as a table').click()
    await expect(money.getByRole('row', { name: /^06\/2026 / })).toContainText('100,000.00')
  })

  test('just after local midnight on the 1st is still the previous day in UTC — both shown honestly', async ({ page }) => {
    await signIn(page)
    const cur = await uniqueCurrency()
    const report = await acceptedBbp(page, cur, '2026-02-20')
    await markPaid(page, report.id, '01/03/2026', '00:30')
    const saved = await (await page.request.get(`/api/reports/${report.id}`)).json()
    expect(new Date(saved.paid_at).toISOString()).toBe('2026-02-28T19:30:00.000Z') // the UTC instant
    await expect(page.getByRole('region', { name: 'Timeline' }).getByText('01/03/2026 00:30')).toBeVisible() // local
    // Dashboard months are UTC calendar months (D-77): this payment counts in 02/2026.
    const b = await (await page.request.get('/api/dashboard/bounties?start=2026-02&end=2026-03')).json()
    const months = b.currencies.find((c: { currency: string }) => c.currency === cur).months
    expect(months).toEqual([
      { month: '2026-02', amount: '100.00', count: 1 },
      { month: '2026-03', amount: '0.00', count: 0 },
    ])
  })
})

test.describe('New York (UTC−4/−5)', () => {
  test.use({ timezoneId: 'America/New_York' })

  test('a calendar start date never moves a day, whatever the time zone', async ({ page }) => {
    await signIn(page)
    const project = await createProject(page, `Start ${Date.now()}`)
    await page.goto(`/projects/${project.id}/edit`)
    await page.getByLabel('Start date').fill('31/12/2025')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText(/Started 31\/12\/2025/)).toBeVisible()
    expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).start_date).toBe('2025-12-31')
    await page.reload()
    await expect(page.getByText(/Started 31\/12\/2025/)).toBeVisible()
  })
})

test('invalid and ambiguous dates are refused with a translated message; nothing is saved', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `Invalid ${Date.now()}`)
  const cases = {
    en: ['Start date', 'Save changes', 'This date does not exist', 'Enter the date as DD/MM/YYYY, day first'],
    ru: ['Дата начала', 'Сохранить изменения', 'Такой даты не существует', 'Введите дату в формате DD/MM/YYYY'],
    uz: ['Boshlanish sanasi', 'Oʻzgarishlarni saqlash', 'Bunday sana mavjud emas', 'Sanani DD/MM/YYYY koʻrinishida'],
  } as const
  for (const [lang, [label, save, invalid, format]] of Object.entries(cases)) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    await page.goto(`/projects/${project.id}/edit`)
    const field = page.getByLabel(label, { exact: true })
    await field.fill('29/02/2026') // not a leap year
    await page.getByRole('button', { name: save }).click()
    await expect(page.getByText(new RegExp(invalid))).toBeVisible()
    await expect(field).toBeFocused()
    await field.fill('05/06/26') // two-digit year: ambiguous
    await field.blur()
    await expect(page.getByText(new RegExp(format))).toBeVisible()
  }
  expect((await (await page.request.get(`/api/projects/${project.id}`)).json()).start_date).toBeNull()
})

test('the calendar works with the keyboard on a 320 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await signIn(page)
  await page.goto('/projects/new')
  await page.getByLabel('Name').fill(`Phone ${Date.now()}`)
  await page.getByLabel('Start date').fill('28/02/2028')
  await page.getByRole('button', { name: 'Choose a date from the calendar' }).click()
  const grid = page.getByRole('grid')
  await expect(grid).toBeVisible()
  await expect(page.getByRole('button', { name: '28/02/2028' })).toBeFocused()
  await expectNoHorizontalOverflow(page, 'calendar at 320')
  const box = (await page.locator('[data-radix-popper-content-wrapper]').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(320)
  await page.keyboard.press('ArrowRight') // leap day
  await expect(page.getByRole('button', { name: '29/02/2028' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Start date')).toHaveValue('29/02/2028')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByText(/Started 29\/02\/2028/)).toBeVisible()
  await expectNoHorizontalOverflow(page, 'project detail at 320')
})

test('every page shows dates day first with a 24-hour clock, in all three languages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  const token = `dt${Date.now()}`
  const project = await createProject(page, `Pages ${token}`)
  const report = await createReport(page, project.id, { title: `Report ${token}` })
  await apiCall(page, 'POST', `/api/reports/${report.id}/status`, { to: 'submitted', at: '2026-01-31T23:30:00Z' })
  const note = await createNote(page, { title: `Note ${token}`, project_id: project.id })
  const paths = ['/', '/projects', `/projects/${project.id}`, '/reports', `/reports/${report.id}`, '/notes', `/notes/${note.id}`, `/search?q=${token}`, '/import']
  const DMY = /\b\d{2}\/\d{2}\/\d{4}\b/
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const path of paths) {
      await page.goto(path)
      await expect(page.locator('main h1')).toBeVisible()
      await page.waitForLoadState('networkidle')
      const text = await page.locator('main').innerText()
      expect(text, `${lang} ${path}: a month-name or 12-hour date`).not.toMatch(MONTH_WORDS)
      expect(text, `${lang} ${path}: an ISO date`).not.toMatch(ISO_DAY)
      if (!['/', '/import'].includes(path)) expect(text, `${lang} ${path}: no DD/MM/YYYY date`).toMatch(DMY)
    }
  }
  // The submitted date (23:30 UTC on 31 January) in the browser's own zone.
  await page.addInitScript(() => localStorage.setItem('hexops.lang', 'en'))
  await page.goto(`/reports/${report.id}`)
  const shown = await page.evaluate(() => {
    const d = new Date('2026-01-31T23:30:00Z')
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
  })
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText(shown)
})
