import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { expectNoHorizontalOverflow, PASSWORD, USER } from './helpers.ts'

/**
 * Stage 8: the whole daily workflow in one pass, through the UI only:
 * login → project with scope → report with evidence and status changes → tagged note
 * → search both → dashboard agrees with the API → export both to PDF → import a PDF
 * as a reviewed draft → save it as a new record → logout.
 */

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

async function downloadPdf(page: Page): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const link = page.getByRole('link', { name: 'Download PDF' })
  await expect(link).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
  return bytes
}

test('the daily workflow, end to end, through the UI', async ({ page }) => {
  test.setTimeout(120_000) // one scenario of ~40 UI steps, two PDF jobs and an import
  const token = `wf${Date.now()}`
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Login through the form.
  await page.goto('/login')
  await page.getByLabel('Username').fill(USER)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${USER}` })).toBeVisible()

  // Project with scope.
  await page.goto('/projects/new')
  await page.getByLabel('Name').fill(`Acme ${token}`)
  await page.getByLabel('Type').selectOption('bounty_program')
  await page.getByRole('button', { name: 'Add asset' }).click()
  await page.getByLabel('Value').fill(`*.${token}.example.com`)
  await page.getByLabel('Kind').selectOption('wildcard')
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Acme ${token}` })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Scope (1)' }).getByText(`*.${token}.example.com`)).toBeVisible()
  const projectUrl = page.url()

  // Report with evidence and status transitions.
  await page.getByRole('link', { name: 'New report for this project' }).click()
  await page.getByLabel('Title').fill(`SQL injection ${token}`)
  await page.getByLabel('Severity').selectOption('critical')
  await page
    .getByLabel('Report (Markdown)')
    .fill(`# Kirish\n\nOʻzbekcha: gʻalaba ${token}. Русский: съешь ещё. English: injection.\n\n| Host | Port |\n|---|---|\n| 10.9.8.7 | 443 |\n`)
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `SQL injection ${token}` })).toBeVisible()
  const reportUrl = page.url()
  await page.getByLabel('Add evidence', { exact: true }).setInputFiles([
    { name: 'shot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'poc.txt', mimeType: 'text/plain', buffer: Buffer.from(`curl ${token}`) },
  ])
  const evidence = page.getByRole('region', { name: 'Evidence' })
  await expect(evidence.getByText('shot.png')).toBeVisible()
  await expect(evidence.getByText('poc.txt')).toBeVisible()
  const status = page.getByRole('region', { name: 'Status' })
  for (const step of ['Submitted', 'Triaged', 'Accepted']) {
    await status.getByRole('button', { name: `Mark as ${step}` }).click()
    await expect(page.getByText(`Status changed to ${step}.`).first()).toBeVisible()
  }

  // Tagged note linked to the project.
  await page.goto('/notes/new')
  await page.getByLabel('Title').fill(`Recon ${token}`)
  await page.getByLabel('Tags').fill('recon')
  await page.getByLabel('Tags').press('Enter')
  await page.getByLabel('Note').fill(`Subdomains of ${token}: api, admin.`)
  await page.getByRole('button', { name: 'Create note' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Recon ${token}` })).toBeVisible()
  const noteUrl = page.url()

  // Search finds both.
  await page.goto('/search')
  await page.getByLabel('Search for').fill(token)
  await expect(page.getByText('Results: 2')).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`SQL injection ${token}`) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`Recon ${token}`) })).toBeVisible()

  // The dashboard shows what the API computes from the records.
  const severity = await (await page.request.get('/api/dashboard/severity')).json()
  await page.goto('/')
  const sev = page.getByRole('region', { name: 'Findings by severity' })
  await expect(sev.getByRole('img')).toHaveAttribute('aria-label', new RegExp(`${severity.total} in total`))
  await sev.getByText('Show data as a table').click()
  await expect(sev.getByRole('row', { name: new RegExp(`Critical ${severity.counts.critical}$`) })).toBeVisible()
  expect(severity.counts.critical).toBeGreaterThanOrEqual(1)

  // Export both to PDF.
  await page.goto(reportUrl)
  const reportPdf = await downloadPdf(page)
  await page.goto(noteUrl)
  await downloadPdf(page)

  // Import the report PDF, review the draft, save it as a NEW report.
  await page.goto('/reports')
  await page.getByRole('link', { name: 'Import PDF' }).click()
  await page.getByLabel('PDF file').setInputFiles({ name: 'finding.pdf', mimeType: 'application/pdf', buffer: reportPdf })
  await page.getByRole('button', { name: 'Convert to Markdown' }).click()
  await expect(page.getByRole('button', { name: 'Continue as new report' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('textbox', { name: 'Markdown' })).toHaveValue(/\|10\.9\.8\.7\|443\|/)
  await page.getByLabel('Title').fill(`Imported ${token}`)
  await page.getByRole('button', { name: 'Continue as new report' }).click()
  await expect(page).toHaveURL('/reports/new')
  await page.getByLabel('Find a project').fill(token)
  await expect(page.getByLabel('Project', { exact: true }).locator('option', { hasText: `Acme ${token}` })).toHaveCount(1)
  await page.getByLabel('Project', { exact: true }).selectOption({ label: `Acme ${token}` })
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(page.getByRole('heading', { level: 1, name: `Imported ${token}` })).toBeVisible()
  expect(page.url()).not.toBe(reportUrl)
  await page.goto(projectUrl)
  const reports = page.getByRole('region', { name: 'Reports' })
  await expect(reports.getByRole('link', { name: `SQL injection ${token}` })).toBeVisible()
  await expect(reports.getByRole('link', { name: `Imported ${token}` })).toBeVisible()

  // Logout ends the session.
  await page.getByRole('button', { name: 'Signed in as' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get('/api/reports')).status()).toBe(401)
})

/** Pages of a realistic workspace, created once per worker through the API. */
async function workspace(page: Page) {
  const csrf = async () => (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value
  const post = async (path: string, data: unknown) => {
    const res = await page.request.post(path, { data, headers: { 'X-CSRF-Token': await csrf() } })
    expect(res.status(), await res.text()).toBe(201)
    return (await res.json()) as { id: number }
  }
  const project = await post('/api/projects', { name: `Matrix ${'W'.repeat(40)}`, type: 'pentest_client', scope: [{ kind: 'domain', value: 'very-long-subdomain-name-for-layout.example.com', note: '' }] })
  const report = await post('/api/reports', {
    project_id: project.id,
    title: `Uzun sarlavha ${'X'.repeat(60)}`,
    type: 'pentest',
    severity: 'high',
    body_md: '| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n\n```\n' + 'x'.repeat(200) + '\n```\n',
  })
  const note = await post('/api/notes', { title: `Qayd ${'Y'.repeat(60)}`, body_md: 'text', tags: ['recon', 'cheat-sheet'], project_id: project.id })
  return [
    '/',
    `/projects/${project.id}`,
    `/reports/${report.id}`,
    `/notes/${note.id}`,
    '/search?q=Uzun',
    '/import',
  ]
}

const LANGS = { en: 'Dashboard', ru: 'Обзор', uz: 'Umumiy koʻrinish' } as const
const THEMES = ['light', 'dark', 'system'] as const
const WIDTHS = [320, 375, 768, 1024, 1920] as const

for (const [lang, dashboardNav] of Object.entries(LANGS)) {
  for (const width of WIDTHS) {
    test(`workflow pages in ${lang} at ${width}px, in each theme`, async ({ page }) => {
      await page.request.post('/api/auth/login', { data: { username: USER, password: PASSWORD } })
      const paths = await workspace(page)
      await page.setViewportSize({ width, height: 900 })
      // Each page in one theme, rotating, so every theme meets every page across the widths.
      for (const [i, path] of paths.entries()) {
        const theme = THEMES[(i + WIDTHS.indexOf(width)) % THEMES.length]
        const osDark = theme === 'system' && width % 2 === 0 // System follows the OS either way
        await page.emulateMedia({ colorScheme: osDark ? 'dark' : 'light' })
        await page.addInitScript(
          ([l, t]) => {
            localStorage.setItem('hexops.lang', l)
            localStorage.setItem('hexops.theme', t)
          },
          [lang, theme],
        )
        await page.goto(path)
        await expect(page.locator('main h1')).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('lang', lang)
        const dark = theme === 'dark' || osDark
        await expect(page.locator('html')).toHaveClass(dark ? /dark/ : /^(?!.*\bdark\b)/)
        await expectNoHorizontalOverflow(page, `${lang} ${width}px ${theme} ${path}`)
      }
      // The navigation is labelled in the chosen language (drawer on phones).
      if (width >= 768) await expect(page.getByRole('link', { name: dashboardNav }).first()).toBeVisible()
      await page.screenshot({ path: `test-results/screens/workflow-${lang}-${width}.png`, fullPage: true })
    })
  }
}
