import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { createNote, createProject, createReport, expectNoHorizontalOverflow, signIn, WIDTHS } from './helpers.ts'

const BODY = [
  '# Kirish',
  '',
  'Oʻzbekcha: gʻalaba. Русский: съешь же ещё. English: injection point.',
  '',
  '```',
  "curl -d \"id=1' OR 1=1 --\" https://api.example.com",
  '```',
  '',
  '| Host | Port |',
  '|---|---|',
  '| 10.0.0.5 | 443 |',
  '',
].join('\n')

/** A valid PDF page with no text layer at all, as a blank scan would be. */
const NO_TEXT_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)

async function exportAndDownload(page: Page): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export PDF' }).click()
  const link = page.getByRole('link', { name: 'Download PDF' })
  await expect(link).toBeVisible({ timeout: 30_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  return readFile((await download.path())!)
}

test('export a report as a PDF, import it back, and save the draft as a NEW note', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `PDF ${Date.now()}`)
  const report = await createReport(page, project.id, { title: `PDF round trip ${Date.now()}`, body_md: BODY })
  await page.goto(`/reports/${report.id}`)
  const pdf = await exportAndDownload(page)
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pdf.length).toBeGreaterThan(5_000)

  await page.goto('/reports')
  await page.getByRole('link', { name: 'Import PDF' }).click()
  await expect(page).toHaveURL('/import')
  await page.getByLabel('PDF file').setInputFiles({ name: 'round-trip.pdf', mimeType: 'application/pdf', buffer: pdf })
  await page.getByRole('button', { name: 'Convert to Markdown' }).click()

  await expect(page.getByText('Pages read: 1. Review the draft before saving.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Complex tables, images and page layout may need manual correction.')).toBeVisible()
  await expect(page.getByLabel('Title')).toHaveValue(report.title)
  const markdown = page.getByRole('textbox', { name: 'Markdown' })
  await expect(markdown).toHaveValue(/# Kirish/)
  await expect(markdown).toHaveValue(/\|10\.0\.0\.5\|443\|/)
  await expect(markdown).toHaveValue(/```\ncurl -d/)

  await page.getByRole('button', { name: 'Continue as new note' }).click()
  await expect(page).toHaveURL('/notes/new')
  await expect(page.getByLabel('Title')).toHaveValue(report.title)
  await page.getByRole('button', { name: 'Create note' }).click()
  await expect(page).toHaveURL(/\/notes\/\d+$/)
  await expect(page.getByRole('heading', { level: 1, name: report.title })).toBeVisible()
  await expect(page.getByRole('cell', { name: '10.0.0.5' })).toBeVisible()

  // The original report is untouched.
  const original = await (await page.request.get(`/api/reports/${report.id}`)).json()
  expect(original.body_md).toBe(BODY)
})

test('a note exports too, in the UI language', async ({ page }) => {
  await signIn(page)
  const note = await createNote(page, { title: `Qayd ${Date.now()}`, body_md: BODY, tags: ['recon'] })
  await page.addInitScript(() => localStorage.setItem('hexops.lang', 'uz'))
  await page.goto(`/notes/${note.id}`)
  await page.getByRole('button', { name: 'PDF eksport' }).click()
  await expect(page.getByRole('link', { name: 'PDFni yuklab olish' })).toBeVisible({ timeout: 30_000 })
})

test('an image-only PDF is refused with the OCR message; nothing is created', async ({ page }) => {
  await signIn(page)
  const before = (await (await page.request.get('/api/notes')).json()).total
  await page.goto('/import')
  await page.getByLabel('PDF file').setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: NO_TEXT_PDF })
  await page.getByRole('button', { name: 'Convert to Markdown' }).click()
  await expect(page.getByText(/looks like a scanned PDF\. OCR is not available yet/)).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('PDF file').setInputFiles({ name: 'photo.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a pdf') })
  await page.getByRole('button', { name: 'Convert to Markdown' }).click()
  await expect(page.getByText('This file is not a PDF.')).toBeVisible()
  expect((await (await page.request.get('/api/notes')).json()).total).toBe(before)
})

test('PDF routes require a session', async ({ page }) => {
  for (const [method, path] of [
    ['POST', '/api/pdf/exports'],
    ['POST', '/api/pdf/imports'],
    ['GET', '/api/pdf/jobs/1'],
    ['GET', '/api/pdf/jobs/1/download'],
    ['DELETE', '/api/pdf/jobs/1'],
  ] as const) {
    expect((await page.request.fetch(path, { method })).status(), `${method} ${path}`).toBe(401)
  }
  await page.goto('/import')
  await expect(page).toHaveURL(/\/login/)
})

test('the import page fits 320–1440 px in all three languages', async ({ page }) => {
  await signIn(page)
  const project = await createProject(page, `PDF layout ${Date.now()}`)
  const report = await createReport(page, project.id, { title: 'W'.repeat(120), body_md: BODY })
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/import')
      await expect(page.locator('main h1')).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${width}px /import`)
      await page.goto(`/reports/${report.id}`)
      await expect(page.locator('main h1')).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${width}px report with export button`)
    }
  }
})

test('the review step fits a phone and a desktop', async ({ page }) => {
  await signIn(page)
  const note = await createNote(page, { title: 'L'.repeat(200), body_md: BODY + '\n' + 'x'.repeat(400) })
  await page.goto(`/notes/${note.id}`)
  const pdf = await exportAndDownload(page)
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/import')
    await page.getByLabel('PDF file').setInputFiles({ name: 'n.pdf', mimeType: 'application/pdf', buffer: pdf })
    await page.getByRole('button', { name: 'Convert to Markdown' }).click()
    await expect(page.getByRole('button', { name: 'Continue as new report' })).toBeVisible({ timeout: 30_000 })
    await expectNoHorizontalOverflow(page, `${width}px review`)
    await page.screenshot({ path: `test-results/screens/pdf-review-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Start over' }).click()
  }
})
