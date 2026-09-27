import { expect, test } from '@playwright/test'

import { apiCall, createProject, createReport, expectNoHorizontalOverflow, signIn, WIDTHS } from './helpers.ts'

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)])

test('create a report in the UI and walk the whole workflow, with an undo', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `WF ${Date.now()}`)
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('link', { name: 'New report for this project' }).click()
  await expect(page).toHaveURL(new RegExp(`/reports/new\\?project_id=${project.id}`))
  await page.getByLabel('Title').fill('IDOR on invoices')
  await page.getByLabel('Severity').selectOption('high')
  await page.getByLabel('CVSS score (optional)').fill('7.5')
  await expect(page.getByText('CVSS 7.5 suggests High.')).toBeVisible()
  await page.getByLabel('Report (Markdown)').fill('## Steps\n\n1. Change the id\n')
  await page.getByRole('button', { name: 'Create report' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'IDOR on invoices' })).toBeVisible()

  const status = page.getByRole('region', { name: 'Status' })
  for (const step of ['Submitted', 'Triaged', 'Accepted', 'Paid']) {
    await status.getByRole('button', { name: `Mark as ${step}` }).click()
    await expect(page.getByText(`Status changed to ${step}.`).first()).toBeVisible()
  }
  await expect(status.getByText('This is a final status.')).toBeVisible()
  await status.getByRole('button', { name: 'Undo: back to Accepted' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Undo: back to Accepted' }).click()
  await expect(status.getByRole('button', { name: 'Mark as Paid' })).toBeVisible()

  const history = page.getByRole('region', { name: 'Activity' })
  await expect(history.getByText('Status corrected: Paid → Accepted')).toBeVisible()
  await expect(history.getByText('Status changed: Draft → Submitted')).toBeVisible()
  await expect(history.getByText('by e2e').first()).toBeVisible()
  const facts = page.getByRole('region', { name: 'Timeline' })
  await expect(facts.getByText('Submitted', { exact: true })).toBeVisible()
  await expect(facts.getByText('Paid', { exact: true })).toHaveCount(0) // cleared by the undo

  // The project page lists the report and its history mentions it.
  await page.goto(`/projects/${project.id}`)
  await expect(page.getByRole('region', { name: 'Reports' }).getByRole('link', { name: 'IDOR on invoices' })).toBeVisible()
})

test('the server refuses illegal transitions, including Paid for non-BBP', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `Illegal ${Date.now()}`)
  const vdp = await createReport(page, project.id, { type: 'vdp' })
  const skip = await apiCall(page, 'POST', `/api/reports/${vdp.id}/status`, { to: 'accepted' })
  expect(skip.status()).toBe(409)
  expect((await skip.json()).code).toBe('invalid_status_transition')
  for (const to of ['submitted', 'triaged', 'accepted']) {
    expect((await apiCall(page, 'POST', `/api/reports/${vdp.id}/status`, { to })).status()).toBe(200)
  }
  const paid = await apiCall(page, 'POST', `/api/reports/${vdp.id}/status`, { to: 'paid' })
  expect((await paid.json()).code).toBe('paid_requires_bbp')
  await page.goto(`/reports/${vdp.id}`)
  await expect(page.getByRole('region', { name: 'Status' }).getByRole('button', { name: 'Mark as Paid' })).toHaveCount(0)
})

test('a project with reports cannot be deleted; the UI says why', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `Keep ${Date.now()}`)
  await createReport(page, project.id, { title: 'Blocking report' })
  await page.goto(`/projects/${project.id}`)
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click()
  await expect(page.getByText('This project still has reports. Delete or move them to another project first.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Reports' }).getByRole('link', { name: 'Blocking report' })).toBeVisible()
})

test('evidence: upload, reject, download safely, delete', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `Evidence ${Date.now()}`)
  const report = await createReport(page, project.id)
  await page.goto(`/reports/${report.id}`)
  const evidence = page.getByRole('region', { name: 'Evidence' })
  const input = page.getByLabel('Add evidence', { exact: true })

  await input.setInputFiles([
    { name: 'shot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'poc.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(document.domain)</script>') },
  ])
  await expect(evidence.getByText('shot.png')).toBeVisible()
  await expect(evidence.getByText('poc.html')).toBeVisible()

  await input.setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: PNG })
  await expect(evidence.getByText('fake.pdf: The file content does not match its extension.')).toBeVisible()
  await input.setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
  await expect(evidence.getByText(/tool\.exe: This file type is not allowed/)).toBeVisible()

  const href = await evidence.getByRole('link', { name: 'Download poc.html' }).getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('text/plain; charset=utf-8')
  expect(res.headers()['content-disposition']).toMatch(/^attachment; filename="poc\.html"/)
  expect(res.headers()['x-content-type-options']).toBe('nosniff')
  expect(await res.text()).toBe('<script>alert(document.domain)</script>')

  // A real browser download: saved, not rendered.
  const [download] = await Promise.all([page.waitForEvent('download'), evidence.getByRole('link', { name: 'Download shot.png' }).click()])
  expect(download.suggestedFilename()).toBe('shot.png')

  await evidence.getByRole('button', { name: 'Remove shot.png' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(evidence.getByText('shot.png')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Activity' }).getByText('Evidence removed: shot.png')).toBeVisible()

  // Signed out: every report and file route is closed.
  await page.context().clearCookies()
  for (const path of [href!, `/api/reports/${report.id}`, `/api/reports/${report.id}/attachments`, '/api/reports']) {
    expect((await page.request.get(path)).status(), path).toBe(401)
  }
})

test('server-side filters, severity sort and pagination', async ({ page }) => {
  await signIn(page)
  const prefix = `Rep${Date.now()}`
  const project = await createProject(page, prefix)
  const severities = ['critical', 'high', 'medium', 'low', 'info']
  for (let i = 1; i <= 25; i++) {
    await createReport(page, project.id, { title: `${prefix} ${String(i).padStart(2, '0')}`, severity: severities[i % 5], type: i % 2 ? 'bbp' : 'vdp' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/reports?project_id=${project.id}`)
  await expect(page.getByText('1–20 of 25')).toBeVisible()
  await page.getByLabel('Sort by').selectOption('severity:desc')
  await expect(page.getByRole('table').getByText('Critical').first()).toBeVisible()
  const firstSeverity = page.getByRole('table').locator('tbody tr').first().getByText(/Critical|High|Medium|Low|Info/).first()
  await expect(firstSeverity).toHaveText('Critical')
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.getByText('21–25 of 25')).toBeVisible()
  await page.getByLabel('Severity', { exact: true }).selectOption('info')
  await expect(page.getByText('1–5 of 5').or(page.getByRole('table'))).toBeVisible()
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(5)
  await page.reload()
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(5)

  // Created-date range (UTC days): today includes them, a range ending yesterday does not.
  // Typed day first (DD/MM/YYYY); the URL and API keep ISO dates.
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const dmy = (iso: string) => iso.split('-').reverse().join('/')
  await page.getByLabel('Created from').fill(dmy(today))
  await page.getByLabel('Created to').fill(dmy(today))
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(5)
  await expect(page).toHaveURL(new RegExp(`created_from=${today}.*created_to=${today}|created_to=${today}.*created_from=${today}`))
  await page.reload()
  await expect(page.getByLabel('Created from')).toHaveValue(dmy(today))
  await page.getByLabel('Created from').fill(dmy(yesterday))
  await page.getByLabel('Created to').fill(dmy(yesterday))
  await expect(page.getByRole('heading', { name: 'No matching reports' })).toBeVisible()
})

test('reports pages fit 320–1440 px in all three languages, with long values', async ({ page }) => {
  test.setTimeout(240_000)
  await signIn(page)
  const project = await createProject(page, `Layout ${'P'.repeat(60)}`)
  const report = await createReport(page, project.id, {
    title: `Long ${'T'.repeat(120)}`,
    cvss_vector: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    cvss_score: '9.3',
    body_md: `${'x'.repeat(400)}\n\`\`\`\n${'y'.repeat(300)}\n\`\`\``,
    bounty_amount: '12345678.90',
    bounty_currency: 'USD',
  })
  await apiCall(page, 'POST', `/api/reports/${report.id}/status`, { to: 'submitted' })
  await page.request.post(`/api/reports/${report.id}/attachments`, {
    headers: { 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value },
    multipart: { file: { name: `${'n'.repeat(120)}.txt`, mimeType: 'text/plain', buffer: Buffer.from('x') } },
  })
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      for (const path of ['/reports', `/reports/${report.id}`, `/reports/${report.id}/edit`, '/reports/new']) {
        await page.goto(path)
        await expect(page.locator('main h1')).toBeVisible()
        await expectNoHorizontalOverflow(page, `${lang} ${width}px ${path}`)
      }
      if (width === 320 || (lang !== 'en' && width === 1024))
        await page.goto(`/reports/${report.id}`).then(() => page.screenshot({ path: `test-results/screens/report-${lang}-${width}.png`, fullPage: true }))
    }
  }
})
