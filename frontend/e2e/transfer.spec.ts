import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { apiCall, createProject, createReport, expectNoHorizontalOverflow, signIn, WIDTHS } from './helpers.ts'

/** Settings → Data (D-90), on the disposable E2E database. */

const PASS = 'e2e transfer passphrase 2026'
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))])

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function state(page: Page) {
  return (await (await page.request.get('/api/transfer/state')).json()) as { counts: Record<string, number> }
}

async function exportArchive(page: Page): Promise<Buffer> {
  await page.goto('/settings/data')
  const section = page.getByRole('region', { name: 'Export all data' })
  await section.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await section.getByLabel('Passphrase again').fill(PASS)
  await section.getByRole('button', { name: 'Create encrypted export' }).click()
  const link = section.getByRole('link', { name: 'Download .hexops file' })
  await expect(link).toBeVisible({ timeout: 60_000 })
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  expect(download.suggestedFilename()).toMatch(/^hexops-\d{8}-\d{4}\.hexops$/)
  return readFile((await download.path())!)
}

async function chooseArchive(page: Page, data: Buffer, passphrase = PASS) {
  const section = page.getByRole('region', { name: 'Import from a .hexops file' })
  await section.getByLabel('Archive file').setInputFiles({ name: 'backup.hexops', mimeType: 'application/octet-stream', buffer: data })
  await section.getByLabel('Passphrase', { exact: true }).fill(passphrase)
  await section.getByRole('button', { name: 'Check archive' }).click()
  return section
}

test('export everything, then replace the data with the archive: same records, same evidence bytes, a verified backup', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await signIn(page)
  const project = await createProject(page, `Transfer ${Date.now()}`)
  const report = await createReport(page, project.id, { title: `Carried over ${Date.now()}`, body_md: '# Kirish\n\nOʻzbek, русский, English.' })
  const up = await page.request.post(`/api/reports/${report.id}/attachments`, {
    multipart: { file: { name: 'shot.png', mimeType: 'image/png', buffer: PNG } },
    headers: { 'X-CSRF-Token': (await page.context().cookies()).find((c) => c.name === 'hexops_csrf')!.value },
  })
  expect(up.status()).toBe(201)
  const attachment = await up.json()
  const before = await state(page)
  const bytesBefore = await (await page.request.get(`/api/reports/${report.id}/attachments/${attachment.id}/download`)).body()

  // Settings shows the way in.
  await page.goto('/settings')
  await page.getByRole('link', { name: 'Export or import data' }).click()
  await expect(page).toHaveURL('/settings/data')

  const data = await exportArchive(page)
  expect(data.subarray(0, 6).toString()).toBe('HEXOPS')
  expect(data.includes(Buffer.from('Carried over'))).toBe(false) // encrypted

  // Import the same archive over the populated instance.
  await page.goto('/settings/data')
  const section = await chooseArchive(page, data)
  await expect(section.getByText('The archive is intact and complete.')).toBeVisible({ timeout: 60_000 })
  await expect(section.locator('[data-count="reports"]')).toContainText(String(before.counts.reports))
  await expect(section.getByText('This installation already has data.')).toBeVisible()
  const replace = section.getByRole('button', { name: 'Replace all data' })
  await expect(replace).toBeDisabled()
  await section.getByLabel(/I understand that all current records/).check()
  await section.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await replace.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Replace all data' }).click()
  await expect(section.getByText('Import finished. All pages now show the imported data.')).toBeVisible({ timeout: 120_000 })
  await expect(section.getByText(/data\/backups\/pre-import-.*\.hexops/)).toBeVisible()

  // Same data afterwards, evidence identical to the byte.
  expect((await state(page)).counts).toEqual(before.counts)
  const bytesAfter = await (await page.request.get(`/api/reports/${report.id}/attachments/${attachment.id}/download`)).body()
  expect(sha(bytesAfter)).toBe(sha(bytesBefore))
  await page.goto(`/reports/${report.id}`)
  await expect(page.getByRole('heading', { level: 1, name: report.title })).toBeVisible()
})

test('a wrong passphrase and a damaged archive are refused with clear messages; nothing changes', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)
  const data = await exportArchive(page)
  const before = await state(page)

  await page.goto('/settings/data')
  let section = await chooseArchive(page, data, 'definitely not the passphrase')
  await expect(section.getByText('The passphrase is wrong for this archive.')).toBeVisible({ timeout: 60_000 })
  await section.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await section.getByRole('button', { name: 'Check again' }).click()
  await expect(section.getByText('The archive is intact and complete.')).toBeVisible({ timeout: 60_000 })

  await page.goto('/settings/data')
  section = await chooseArchive(page, data.subarray(0, Math.floor(data.length / 2)))
  await expect(section.getByText('The archive is damaged or incomplete.')).toBeVisible({ timeout: 60_000 })

  await page.goto('/settings/data')
  const notArchive = page.getByRole('region', { name: 'Import from a .hexops file' })
  await notArchive.getByLabel('Archive file').setInputFiles({ name: 'x.hexops', mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04 zip') })
  await notArchive.getByLabel('Passphrase', { exact: true }).fill(PASS)
  await notArchive.getByRole('button', { name: 'Check archive' }).click()
  await expect(notArchive.getByText('This is not a .hexops archive.')).toBeVisible()
  expect((await state(page)).counts).toEqual(before.counts)
})

test('transfer routes need a session, and writes need the CSRF token', async ({ page }) => {
  for (const [method, path] of [
    ['GET', '/api/transfer/state'],
    ['POST', '/api/transfer/exports'],
    ['POST', '/api/transfer/imports'],
    ['GET', '/api/transfer/jobs/1'],
    ['POST', '/api/transfer/jobs/1/apply'],
    ['GET', '/api/transfer/jobs/1/download'],
  ] as const) {
    expect((await page.request.fetch(path, { method })).status(), `${method} ${path}`).toBe(401)
  }
  await signIn(page)
  const res = await page.request.post('/api/transfer/exports', { data: { passphrase: PASS } })
  expect(res.status()).toBe(403)
  expect((await apiCall(page, 'POST', '/api/transfer/exports', { passphrase: 'short' })).status()).toBe(422)
})

test('the data page fits 320–1440 px in all three languages', async ({ page }) => {
  await signIn(page)
  for (const lang of ['en', 'ru', 'uz'] as const) {
    await page.addInitScript((l) => localStorage.setItem('hexops.lang', l), lang)
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/settings/data')
      await expect(page.locator('main h1')).toBeVisible()
      await expectNoHorizontalOverflow(page, `${lang} ${width}px /settings/data`)
    }
  }
})
