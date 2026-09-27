import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import type { PdfJob } from './api'
import { readImportDraft } from './draftState'
import { ExportPdfButton } from './ExportPdfButton'
import ImportPage from './ImportPage'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function job(over: Partial<PdfJob>): PdfJob {
  return {
    id: 7,
    kind: 'export',
    status: 'queued',
    progress: 0,
    source_type: 'report',
    source_id: 3,
    original_name: null,
    result_filename: null,
    page_count: null,
    warnings: [],
    error_code: null,
    created_at: '2026-09-26T10:00:00Z',
    finished_at: null,
    expires_at: '2026-09-26T11:00:00Z',
    draft: null,
    ...over,
  }
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockApi(given: Record<string, Handler>) {
  const handlers: Record<string, Handler> = {
    'GET /api/pdf/limits': () => json(200, { max_bytes: 20 * 1024 * 1024, max_pages: 200 }),
    ...given,
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (!handlers[key]) throw new Error(`unexpected ${key}`)
    return handlers[key](url, init)
  })
}

/** Answers successive status requests with the given jobs, repeating the last. */
function sequence(...jobs: PdfJob[]): Handler {
  let i = 0
  return () => json(200, jobs[Math.min(i++, jobs.length - 1)])
}

function Where() {
  const location = useLocation()
  const draft = readImportDraft(location.state)
  return (
    <p>
      at {location.pathname} {draft ? JSON.stringify(draft) : 'no draft'}
    </p>
  )
}

function renderAt(path: string, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '/reports/new', element: <Where /> },
      { path: '/notes/new', element: <Where /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

const calls = (spy: ReturnType<typeof mockApi>, path: string) =>
  spy.mock.calls.filter(([u]) => new URL(String(u), 'http://x').pathname === path)

describe('ExportPdfButton', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('starts an export in the UI language, follows it by long poll, then offers the download', async () => {
    const spy = mockApi({
      'POST /api/pdf/exports': () => json(202, job({})),
      'GET /api/pdf/jobs/7': sequence(
        job({ status: 'running', progress: 40 }),
        job({ status: 'done', progress: 100, result_filename: 'SQLi.pdf' }),
      ),
    })
    await i18n.changeLanguage('ru')
    renderAt('/r', <ExportPdfButton sourceType="report" sourceId={3} />)
    await userEvent.click(screen.getByRole('button', { name: 'Экспорт в PDF' }))
    const link = await screen.findByRole('link', { name: 'Скачать PDF' })
    expect(link).toHaveAttribute('href', '/api/pdf/jobs/7/download')
    expect(link).toHaveAttribute('download', 'SQLi.pdf')
    expect(await screen.findByText('PDF готов к скачиванию.')).toBeInTheDocument()

    const [, init] = calls(spy, '/api/pdf/exports')[0]
    expect(JSON.parse(String(init!.body))).toEqual({ source_type: 'report', source_id: 3, lang: 'ru' })
    // Every status request is a long poll, and there are only a few of them.
    const polls = calls(spy, '/api/pdf/jobs/7').map(([u]) => new URL(String(u), 'http://x'))
    expect(polls.every((u) => u.searchParams.get('wait') === '20')).toBe(true)
    expect(polls.length).toBeLessThanOrEqual(3)
  })

  it('shows progress while working and a translated reason when the job fails', async () => {
    mockApi({
      'POST /api/pdf/exports': () => json(202, job({})),
      'GET /api/pdf/jobs/7': sequence(
        job({ status: 'running', progress: 60 }),
        job({ status: 'failed', progress: 60, error_code: 'pdf_renderer_missing' }),
      ),
    })
    renderAt('/r', <ExportPdfButton sourceType="note" sourceId={3} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(await screen.findByText('The PDF renderer is not installed on the server (see README).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeEnabled() // can try again
  })

  it('reports a refused request', async () => {
    mockApi({
      'POST /api/pdf/exports': () => json(404, { detail: 'x', code: 'pdf_source_not_found' }),
    })
    renderAt('/r', <ExportPdfButton sourceType="report" sourceId={3} />)
    await userEvent.click(screen.getByRole('button', { name: 'Export PDF' }))
    expect(await screen.findByText('That report or note no longer exists.')).toBeInTheDocument()
  })
})

const pdfFile = () => new File(['%PDF-1.7 test'], 'finding.pdf', { type: 'application/pdf' })

describe('ImportPage', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows the limits configured on the server', async () => {
    mockApi({ 'GET /api/pdf/limits': () => json(200, { max_bytes: 5 * 1024 * 1024, max_pages: 30 }) })
    renderAt('/import', <ImportPage />)
    expect(await screen.findByText('Up to 5 MB and 30 pages.')).toBeInTheDocument()
  })

  it('states the limits and that OCR is not available before anything is uploaded', async () => {
    mockApi({})
    renderAt('/import', <ImportPage />)
    expect(await screen.findByText('Up to 20 MB and 200 pages.')).toBeInTheDocument()
    expect(screen.getByText(/Scanned \(image-only\) PDFs need OCR, which is not available/)).toBeInTheDocument()
    expect(screen.getByText('Complex tables, images and page layout may need manual correction.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Convert to Markdown' })).toBeDisabled()
  })

  it('uploads, shows the draft with its warnings for review, and continues as a NEW report', async () => {
    const draft = { title: 'Imported finding', markdown: '# Steps\n\n```\ncurl -X POST\n```\n' }
    const spy = mockApi({
      'POST /api/pdf/imports': () => json(202, job({ kind: 'import', source_type: null, source_id: null })),
      'GET /api/pdf/jobs/7': sequence(
        job({ kind: 'import', status: 'running', progress: 50 }),
        job({ kind: 'import', status: 'done', progress: 100, page_count: 2, draft, warnings: ['pdf_tables_detected', 'pdf_images_skipped'] }),
      ),
      'DELETE /api/pdf/jobs/7': () => new Response(null, { status: 204 }),
    })
    const router = renderAt('/import', <ImportPage />)
    await userEvent.upload(await screen.findByLabelText('PDF file'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Convert to Markdown' }))

    expect(await screen.findByText('Pages read: 2. Review the draft before saving.')).toBeInTheDocument()
    const warnings = screen.getByRole('list', { name: 'What to check' })
    expect(within(warnings).getByText(/Tables were converted/)).toBeInTheDocument()
    expect(within(warnings).getByText(/Images were skipped/)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Imported finding')
    expect(screen.getByRole('textbox', { name: 'Markdown' })).toHaveValue(draft.markdown)

    const [, init] = calls(spy, '/api/pdf/imports')[0]
    expect(init!.body).toBeInstanceOf(FormData)
    expect(((init!.body as FormData).get('file') as File).name).toBe('finding.pdf')

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Edited title')
    await userEvent.click(screen.getByRole('button', { name: 'Continue as new report' }))
    expect(await screen.findByText(`at /reports/new ${JSON.stringify({ title: 'Edited title', body_md: draft.markdown })}`)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/reports/new')
    expect(calls(spy, '/api/pdf/jobs/7').some(([, i]) => i?.method === 'DELETE')).toBe(true)
    // Nothing was created: only the PDF endpoints were called.
    expect(spy.mock.calls.every(([u]) => new URL(String(u), 'http://x').pathname.startsWith('/api/pdf/'))).toBe(true)
  })

  it('continues as a new note too', async () => {
    mockApi({
      'POST /api/pdf/imports': () => json(202, job({ kind: 'import' })),
      'GET /api/pdf/jobs/7': () => json(200, job({ kind: 'import', status: 'done', page_count: 1, draft: { title: 'T', markdown: 'body' } })),
      'DELETE /api/pdf/jobs/7': () => new Response(null, { status: 204 }),
    })
    renderAt('/import', <ImportPage />)
    await userEvent.upload(await screen.findByLabelText('PDF file'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Convert to Markdown' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Continue as new note' }))
    expect(await screen.findByText(`at /notes/new ${JSON.stringify({ title: 'T', body_md: 'body' })}`)).toBeInTheDocument()
  })

  it('explains an image-only PDF: no OCR', async () => {
    await i18n.changeLanguage('uz')
    mockApi({
      'POST /api/pdf/imports': () => json(202, job({ kind: 'import' })),
      'GET /api/pdf/jobs/7': () => json(200, job({ kind: 'import', status: 'failed', error_code: 'pdf_no_text' })),
    })
    renderAt('/import', <ImportPage />)
    await userEvent.upload(await screen.findByLabelText('PDF fayl'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Markdownga aylantirish' }))
    expect(await screen.findByText(/OCR hozircha mavjud emas/)).toHaveAttribute('role', 'alert')
  })

  it.each([
    ['pdf_unsupported', 422, 'This file is not a PDF.'],
    ['pdf_too_large', 413, 'The PDF is too large.'],
  ])('shows a refused upload (%s)', async (code, status, message) => {
    mockApi({ 'POST /api/pdf/imports': () => json(status, { detail: 'x', code }) })
    renderAt('/import', <ImportPage />)
    await userEvent.upload(await screen.findByLabelText('PDF file'), pdfFile())
    await userEvent.click(screen.getByRole('button', { name: 'Convert to Markdown' }))
    expect(await screen.findByText(message)).toHaveAttribute('role', 'alert')
  })

  it.each(['pdf_encrypted', 'pdf_malformed', 'pdf_too_many_pages', 'pdf_job_interrupted'])(
    'translates the job failure %s in every language',
    async (code) => {
      for (const lng of ['en', 'ru', 'uz']) {
        expect(i18n.exists(`errors.codes.${code}`, { lng })).toBe(true)
      }
    },
  )
})

describe('readImportDraft', () => {
  it('accepts only a well-formed draft', () => {
    expect(readImportDraft({ importDraft: { title: 'a', body_md: 'b' } })).toEqual({ title: 'a', body_md: 'b' })
    expect(readImportDraft(null)).toBeUndefined()
    expect(readImportDraft({ importDraft: { title: 1, body_md: 'b' } })).toBeUndefined()
    expect(readImportDraft({ other: true })).toBeUndefined()
  })
})
