import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import type { TransferJob } from './api'
import DataPage from './DataPage'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const COUNTS = { projects: 2, project_scope_items: 2, reports: 2, report_attachments: 3, tags: 3, notes: 2, note_tags: 3, activity_logs: 9 }
const EMPTY = Object.fromEntries(Object.keys(COUNTS).map((k) => [k, 0]))
const PASS = 'correct horse battery staple'

function job(over: Partial<TransferJob>): TransferJob {
  return {
    id: 4,
    kind: 'export',
    status: 'queued',
    stage: 'queued',
    progress: 0,
    archive_size: null,
    original_name: null,
    preview: null,
    backup_name: null,
    error_code: null,
    created_at: '2026-09-27T10:00:00Z',
    finished_at: null,
    expires_at: '2026-09-27T11:00:00Z',
    download_name: null,
    ...over,
  }
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockApi(given: Record<string, Handler>, populated = false) {
  const handlers: Record<string, Handler> = {
    'GET /api/transfer/state': () => json(200, { counts: populated ? COUNTS : EMPTY, populated, busy: false, max_archive_bytes: 2 ** 31 }),
    ...given,
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (!handlers[key]) throw new Error(`unexpected ${key}`)
    return handlers[key](url, init)
  })
}

function sequence(...jobs: TransferJob[]): Handler {
  let i = 0
  return () => json(200, jobs[Math.min(i++, jobs.length - 1)])
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/settings/data', element: <DataPage /> }], { initialEntries: ['/settings/data'] })
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

const bodyOf = (spy: ReturnType<typeof mockApi>, method: string, path: string) =>
  spy.mock.calls.find(([u, i]) => new URL(String(u), 'http://x').pathname === path && i?.method === method)?.[1]?.body

const archive = () => new File([new Uint8Array([72, 69, 88, 79, 80, 83, 0, 1])], 'hexops-20260927.hexops')

describe('Settings → Data: export', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('asks for a passphrase twice, then offers the encrypted file', async () => {
    const spy = mockApi({
      'POST /api/transfer/exports': () => json(202, job({})),
      'GET /api/transfer/jobs/4': sequence(
        job({ status: 'running', stage: 'export', progress: 40 }),
        job({ status: 'done', stage: 'done', progress: 100, archive_size: 1_572_864, download_name: 'hexops-20260927-1000.hexops' }),
      ),
    })
    renderPage()
    const section = await screen.findByRole('region', { name: 'Export all data' })
    expect(within(section).getByText(/HexOps cannot recover it/)).toBeInTheDocument()
    await userEvent.type(within(section).getByLabelText('Passphrase'), 'short')
    await userEvent.click(within(section).getByRole('button', { name: 'Create encrypted export' }))
    expect(within(section).getByText('Use at least 12 characters.')).toBeInTheDocument()
    await userEvent.clear(within(section).getByLabelText('Passphrase'))
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.type(within(section).getByLabelText('Passphrase again'), `${PASS}!`)
    await userEvent.click(within(section).getByRole('button', { name: 'Create encrypted export' }))
    expect(bodyOf(spy, 'POST', '/api/transfer/exports')).toBeUndefined() // mismatch: nothing sent

    await userEvent.clear(within(section).getByLabelText('Passphrase again'))
    await userEvent.type(within(section).getByLabelText('Passphrase again'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Create encrypted export' }))
    const link = await within(section).findByRole('link', { name: 'Download .hexops file' })
    expect(link).toHaveAttribute('href', '/api/transfer/jobs/4/download')
    expect(within(section).getByText(/1\.5 MB\. Download it before 27\/09\/2026/)).toBeInTheDocument()
    expect(JSON.parse(String(bodyOf(spy, 'POST', '/api/transfer/exports')))).toEqual({ passphrase: PASS })
    // The passphrase fields are cleared once the job starts.
    expect(within(section).getByLabelText('Passphrase')).toHaveValue('')
  })
})

describe('Settings → Data: import', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  const validated = (populated: boolean) =>
    job({
      kind: 'import',
      status: 'validated',
      stage: 'validated',
      progress: 100,
      preview: {
        source: { created_at: '2026-09-26T08:00:00Z', app_version: '0.1.0', schema_version: '0008', source_owner: 'researcher', counts: COUNTS, files: 3, file_bytes: 20_480 },
        target: { counts: populated ? { ...COUNTS, reports: 7 } : EMPTY, populated },
        space: { needed_bytes: 3_145_728, free_bytes: 10_737_418_240 },
      },
    })

  it('checks the archive, previews it, and imports into an empty installation', async () => {
    const spy = mockApi({
      'POST /api/transfer/imports': () => json(202, job({ kind: 'import' })),
      'GET /api/transfer/jobs/4': sequence(job({ kind: 'import', status: 'running', stage: 'check', progress: 50 }), validated(false)),
      'POST /api/transfer/jobs/4/apply': () => json(202, job({ kind: 'import', status: 'queued' })),
    })
    renderPage()
    const section = await screen.findByRole('region', { name: 'Import from a .hexops file' })
    expect(within(section).getByText(/Accounts are not in the archive/)).toBeInTheDocument()
    await userEvent.upload(within(section).getByLabelText('Archive file'), archive())
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Check archive' }))

    expect(await within(section).findByText('The archive is intact and complete.')).toBeInTheDocument()
    expect(within(section).getByText('Created 26/09/2026 13:00 by researcher with HexOps 0.1.0.'.replace('13:00', new Date('2026-09-26T08:00:00Z').toTimeString().slice(0, 5)))).toBeInTheDocument()
    const row = (kind: string) => section.querySelector(`[data-count="${kind}"]`)?.textContent
    expect(row('reports')).toBe('Reports20')
    expect(row('report_attachments')).toBe('Evidence files30')
    expect(within(section).getByText('Disk space needed: 3 MB (free: 10 GB).')).toBeInTheDocument()
    const form = bodyOf(spy, 'POST', '/api/transfer/imports') as FormData
    expect(form.get('passphrase')).toBe(PASS)
    expect((form.get('file') as File).name).toBe('hexops-20260927.hexops')

    // Empty installation: no replace warning; the passphrase is asked again.
    expect(within(section).queryByText('This installation already has data.')).not.toBeInTheDocument()
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Import' }))
    await vi.waitFor(() => expect(bodyOf(spy, 'POST', '/api/transfer/jobs/4/apply')).toBeDefined())
    expect(JSON.parse(String(bodyOf(spy, 'POST', '/api/transfer/jobs/4/apply')))).toEqual({ passphrase: PASS, replace: false })
  })

  it('replacing data needs the checkbox and a final confirmation; the backup is named', async () => {
    // The job stays validated until the owner applies it; then it runs and finishes.
    let applied = false
    const after = sequence(
      job({ kind: 'import', status: 'running', stage: 'backup', progress: 30 }),
      job({ kind: 'import', status: 'done', stage: 'done', progress: 100, backup_name: 'pre-import-20260927-100000-job4.hexops' }),
    )
    const spy = mockApi(
      {
        'POST /api/transfer/imports': () => json(202, job({ kind: 'import' })),
        'GET /api/transfer/jobs/4': (u, i) => (applied ? after(u, i) : json(200, validated(true))),
        'POST /api/transfer/jobs/4/apply': () => ((applied = true), json(202, job({ kind: 'import', status: 'queued' }))),
      },
      true,
    )
    renderPage()
    const section = await screen.findByRole('region', { name: 'Import from a .hexops file' })
    await userEvent.upload(within(section).getByLabelText('Archive file'), archive())
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Check archive' }))
    expect(await within(section).findByText('This installation already has data.')).toBeInTheDocument()
    expect(section.querySelector('[data-count="reports"]')?.textContent).toBe('Reports27')

    const replace = within(section).getByRole('button', { name: 'Replace all data' })
    expect(replace).toBeDisabled() // not before the checkbox
    await userEvent.click(within(section).getByLabelText(/I understand that all current records/))
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(replace)
    const dialog = await screen.findByRole('alertdialog', { name: 'Replace all data?' })
    expect(bodyOf(spy, 'POST', '/api/transfer/jobs/4/apply')).toBeUndefined() // not before confirming
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace all data' }))
    await vi.waitFor(() => expect(bodyOf(spy, 'POST', '/api/transfer/jobs/4/apply')).toBeDefined())
    expect(JSON.parse(String(bodyOf(spy, 'POST', '/api/transfer/jobs/4/apply')))).toEqual({ passphrase: PASS, replace: true })
    expect(await within(section).findByText('Import finished. All pages now show the imported data.')).toBeInTheDocument()
    expect(within(section).getByText(/data\/backups\/pre-import-20260927-100000-job4\.hexops/)).toBeInTheDocument()
  })

  it('a wrong passphrase can be retried without uploading again', async () => {
    const spy = mockApi({
      'POST /api/transfer/imports': () => json(202, job({ kind: 'import' })),
      'GET /api/transfer/jobs/4': sequence(job({ kind: 'import', status: 'failed', error_code: 'transfer_wrong_passphrase' }), validated(false)),
      'POST /api/transfer/jobs/4/check': () => json(202, job({ kind: 'import', status: 'queued' })),
    })
    renderPage()
    const section = await screen.findByRole('region', { name: 'Import from a .hexops file' })
    await userEvent.upload(within(section).getByLabelText('Archive file'), archive())
    await userEvent.type(within(section).getByLabelText('Passphrase'), 'the wrong passphrase')
    await userEvent.click(within(section).getByRole('button', { name: 'Check archive' }))
    expect(await within(section).findByText('The passphrase is wrong for this archive.')).toBeInTheDocument()
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Check again' }))
    expect(await within(section).findByText('The archive is intact and complete.')).toBeInTheDocument()
    expect(JSON.parse(String(bodyOf(spy, 'POST', '/api/transfer/jobs/4/check')))).toEqual({ passphrase: PASS })
  })

  it.each([
    ['transfer_unsafe_path', 'The archive contains an unsafe file path and was refused.'],
    ['transfer_checksum_mismatch', 'A file in the archive does not match its checksum.'],
    ['transfer_apply_failed', 'The import failed; the previous data was kept unchanged.'],
  ])('explains %s', async (code, message) => {
    mockApi({
      'POST /api/transfer/imports': () => json(202, job({ kind: 'import' })),
      'GET /api/transfer/jobs/4': () => json(200, job({ kind: 'import', status: 'failed', error_code: code })),
    })
    renderPage()
    const section = await screen.findByRole('region', { name: 'Import from a .hexops file' })
    await userEvent.upload(within(section).getByLabelText('Archive file'), archive())
    await userEvent.type(within(section).getByLabelText('Passphrase'), PASS)
    await userEvent.click(within(section).getByRole('button', { name: 'Check archive' }))
    expect(await within(section).findByText(message)).toBeInTheDocument()
  })

  it('is translated', async () => {
    await i18n.changeLanguage('uz')
    mockApi({})
    renderPage()
    expect(await screen.findByRole('region', { name: 'Barcha maʼlumotlarni eksport qilish' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '.hexops faylidan import qilish' })).toBeInTheDocument()
  })
})
