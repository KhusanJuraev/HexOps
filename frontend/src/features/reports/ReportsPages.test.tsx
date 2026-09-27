import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import ReportDetailPage from './ReportDetailPage'
import ReportEditPage from './ReportEditPage'
import ReportNewPage from './ReportNewPage'
import ReportsPage from './ReportsPage'
import type { Report, ReportListItem } from './types'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const empty = (size = 20) => json(200, { items: [], total: 0, page: 1, size })

const REPORT: Report = {
  id: 5,
  project_id: 7,
  project_name: 'Acme',
  title: 'Stored XSS',
  type: 'bbp',
  severity: 'high',
  cvss_score: '8.2',
  cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:L/A:N',
  status: 'triaged',
  submitted_at: '2026-09-20T10:00:00Z',
  triaged_at: '2026-09-21T10:00:00Z',
  closed_at: null,
  paid_at: null,
  bounty_amount: null,
  bounty_currency: null,
  body_md: '## Steps\n1. `<script>`',
  created_at: '2026-09-19T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  next_statuses: ['accepted', 'duplicate', 'rejected'],
  correction_to: 'submitted',
}
const ITEM: ReportListItem = { ...REPORT }

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockApi(handlers: Record<string, Handler>) {
  const defaults: Record<string, Handler> = {
    'GET /api/projects': () => json(200, { items: [{ id: 7, name: 'Acme' }, { id: 8, name: 'Zeta' }], total: 2, page: 1, size: 100 }),
    'GET /api/activity': () => empty(),
    'GET /api/reports/evidence-limits': () => json(200, { max_bytes: 25 * 1024 * 1024, max_files: 100 }),
  }
  const all = { ...defaults, ...handlers }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    if (!all[key]) throw new Error(`unexpected ${key}`)
    return all[key](url, init)
  })
}

function renderAt(path: string | { pathname: string; search?: string; state?: unknown }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/reports', element: <ReportsPage /> },
      { path: '/reports/new', element: <ReportNewPage /> },
      { path: '/reports/:reportId', element: <ReportDetailPage /> },
      { path: '/reports/:reportId/edit', element: <ReportEditPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

const sent = (spy: ReturnType<typeof mockApi>, method: string, path: string) => {
  const call = spy.mock.calls.find(([u, i]) => new URL(String(u), 'http://x').pathname === path && i?.method === method)
  return call?.[1]?.body
}

describe('reports list', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('sends URL filters to the server and renders rows without bodies', async () => {
    const spy = mockApi({ 'GET /api/reports': () => json(200, { items: [ITEM], total: 1, page: 1, size: 20 }) })
    renderAt('/reports?project_id=7&severity=high&status=triaged&sort=severity&order=desc')
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'Stored XSS' })).toHaveAttribute('href', '/reports/5')
    expect(within(table).getByText('Triaged')).toBeInTheDocument()
    const url = new URL(String(spy.mock.calls.find(([u]) => String(u).startsWith('/api/reports'))![0]), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ project_id: '7', severity: 'high', status: 'triaged', sort: 'severity', size: '20' })
  })

  it('filters by created date: the range goes to the server and into the URL', async () => {
    const spy = mockApi({ 'GET /api/reports': () => json(200, { items: [ITEM], total: 1, page: 1, size: 20 }) })
    const router = renderAt('/reports?created_from=2026-02-01&created_to=2026-01-01')
    await screen.findByRole('table')
    const sent = () =>
      spy.mock.calls
        .map(([u]) => new URL(String(u), 'http://x'))
        .filter((u) => u.pathname === '/api/reports')
        .map((u) => Object.fromEntries(u.searchParams))
    // A reversed range keeps only its start.
    expect(sent()[0]).toEqual({ created_from: '2026-02-01', size: '20' })
    // Shown day first (DD/MM/YYYY); the API keeps ISO dates.
    expect(screen.getByLabelText('Created from')).toHaveValue('01/02/2026')
    expect(screen.getByLabelText('Created to')).toHaveValue('')

    await userEvent.type(screen.getByLabelText('Created to'), '28/02/2026')
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ created_from: '2026-02-01', created_to: '2026-02-28', size: '20' }))
    // Not a day: nothing is sent, and the field says why once the user leaves it.
    await userEvent.clear(screen.getByLabelText('Created from'))
    await userEvent.type(screen.getByLabelText('Created from'), '31/02/2026')
    await userEvent.tab()
    expect(screen.getByText('This date does not exist (check the day and month).')).toBeInTheDocument()
    expect(sent().at(-1)).toEqual({ created_to: '2026-02-28', size: '20' })
    expect(router.state.location.search).toContain('created_to=2026-02-28')
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await vi.waitFor(() => expect(sent().at(-1)).toEqual({ size: '20' }))
  })

  it('ignores dates that are not real days', async () => {
    const spy = mockApi({ 'GET /api/reports': () => json(200, { items: [ITEM], total: 1, page: 1, size: 20 }) })
    renderAt('/reports?created_from=2026-02-30&created_to=soon')
    await screen.findByRole('table')
    const url = new URL(String(spy.mock.calls.find(([u]) => String(u).startsWith('/api/reports'))![0]), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ size: '20' })
  })

  it('empty states: none at all vs. none matching', async () => {
    mockApi({ 'GET /api/reports': () => empty() })
    renderAt('/reports')
    expect(await screen.findByRole('heading', { name: 'No reports yet' })).toBeInTheDocument()
  })
})

describe('report form', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('creates a report; CVSS is a hint that never changes the severity', async () => {
    const spy = mockApi({
      'POST /api/reports': (_u, init) => json(201, { ...REPORT, ...JSON.parse(String(init!.body)), id: 9, status: 'draft' }),
      'GET /api/reports/9': () => json(200, REPORT),
      'GET /api/reports/9/attachments': () => json(200, []),
    })
    const router = renderAt('/reports/new?project_id=7')
    await userEvent.type(await screen.findByLabelText('Title'), 'SQLi in search')
    expect(screen.getByLabelText('Project')).toHaveValue('7')
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'low')
    await userEvent.type(screen.getByLabelText('CVSS score (optional)'), '9.8')
    expect(screen.getByText('CVSS 9.8 suggests Critical.')).toBeInTheDocument()
    expect(screen.getByText('Your severity differs from the CVSS rating. Both are kept as entered.')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Amount'), '1500.50')
    await userEvent.type(screen.getByLabelText('Currency (ISO code, e.g. USD)'), 'usd')
    await userEvent.type(screen.getByLabelText('Report (Markdown)'), '# Title')
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))

    expect(JSON.parse(String(sent(spy, 'POST', '/api/reports')))).toEqual({
      project_id: 7,
      title: 'SQLi in search',
      type: 'bbp',
      severity: 'low',
      cvss_score: '9.8',
      cvss_vector: null,
      body_md: '# Title',
      bounty_amount: '1500.50',
      bounty_currency: 'USD',
    })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/reports/9'))
  })

  it('bounty fields exist only for BBP, and nothing is sent for other types', async () => {
    const spy = mockApi({ 'POST /api/reports': () => json(201, { ...REPORT, id: 9 }), 'GET /api/reports/9': () => json(200, REPORT), 'GET /api/reports/9/attachments': () => json(200, []) })
    renderAt('/reports/new?project_id=7')
    await userEvent.type(await screen.findByLabelText('Title'), 'x')
    await userEvent.type(screen.getByLabelText('Amount'), '10')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'vdp')
    expect(screen.queryByLabelText('Amount')).not.toBeInTheDocument()
    expect(screen.getByText('Bounties can be recorded on bug bounty (BBP) reports.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    const body = JSON.parse(String(sent(spy, 'POST', '/api/reports')))
    expect(body.bounty_amount).toBeNull()
    expect(body.bounty_currency).toBeNull()
  })

  it('requires a project and shows server errors on their fields', async () => {
    mockApi({
      'POST /api/reports': () =>
        json(422, { detail: 'x', code: 'validation_error', errors: [{ field: 'cvss_vector', code: 'cvss_vector_invalid', params: {} }] }),
    })
    renderAt('/reports/new')
    await userEvent.type(await screen.findByLabelText('Title'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    expect(screen.getByLabelText('Project')).toHaveAccessibleDescription('This field is required.')
    await userEvent.selectOptions(screen.getByLabelText('Project'), '8')
    await userEvent.type(screen.getByLabelText('CVSS vector (optional)'), 'CVSS:3.1/AV:N')
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    expect(await screen.findByText(/Enter a CVSS 3.x or 4.0 vector/)).toBeInTheDocument()
  })

  it('offers to create a project first when there are none', async () => {
    mockApi({ 'GET /api/projects': () => empty(100) })
    renderAt('/reports/new')
    expect(await screen.findByText('Create a project first: every report belongs to one.')).toBeInTheDocument()
  })
})

describe('report from an imported PDF draft', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('opens the new-report form prefilled and creates a NEW report', async () => {
    const draft = { title: 'Imported SQLi', body_md: '## Steps\n\n```\ncurl x\n```\n' }
    const spy = mockApi({
      'POST /api/reports': (_u, init) => json(201, { ...REPORT, ...JSON.parse(String(init!.body)), id: 9, status: 'draft' }),
      'GET /api/reports/9': () => json(200, REPORT),
      'GET /api/reports/9/attachments': () => json(200, []),
    })
    const router = renderAt({ pathname: '/reports/new', search: '?project_id=7', state: { importDraft: draft } })
    expect(await screen.findByLabelText('Title')).toHaveValue('Imported SQLi')
    expect(screen.getByLabelText('Report (Markdown)')).toHaveValue(draft.body_md)
    expect(screen.getByText('From an imported PDF. Review, then save.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create report' }))
    const sentBody = JSON.parse(String(sent(spy, 'POST', '/api/reports')))
    expect([sentBody.title, sentBody.body_md, sentBody.project_id]).toEqual(['Imported SQLi', draft.body_md, 7])
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/reports/9'))
  })
})

describe('report detail', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  const detailApi = (extra: Record<string, Handler> = {}) =>
    mockApi({
      'GET /api/reports/5': () => json(200, REPORT),
      'GET /api/reports/5/attachments': () =>
        json(200, [{ id: 3, report_id: 5, original_name: 'poc.py', content_type: 'text/plain; charset=utf-8', size_bytes: 2048, sha256: 'a'.repeat(64), created_at: '2026-09-21T10:00:00Z' }]),
      ...extra,
    })

  it('states the evidence size limit configured on the server', async () => {
    detailApi({ 'GET /api/reports/evidence-limits': () => json(200, { max_bytes: 10 * 1024 * 1024, max_files: 100 }) })
    renderAt('/reports/5')
    expect(await screen.findByText(/text and source files up to 10 MB\./)).toBeInTheDocument()
  })

  it('shows dates as DD/MM/YYYY HH:mm and records a payment date typed day first', async () => {
    const accepted = { ...REPORT, status: 'accepted' as const, closed_at: '2026-09-22T10:00:00Z', bounty_amount: '100.00', bounty_currency: 'USD', next_statuses: ['paid' as const], correction_to: 'triaged' as const }
    const spy = detailApi({
      'GET /api/reports/5': () => json(200, accepted),
      'POST /api/reports/5/status': (_u, init) => json(200, { ...accepted, status: 'paid', paid_at: JSON.parse(String(init!.body)).at, next_statuses: [], correction_to: 'accepted' }),
    })
    renderAt('/reports/5')
    const status = await screen.findByRole('region', { name: 'Status' })
    // Existing timeline dates, in the viewer's zone, day first, 24-hour.
    const local = (iso: string) => {
      const d = new Date(iso)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
    }
    expect(screen.getByText(local('2026-09-20T10:00:00Z'))).toBeInTheDocument()

    // A date without a time is not sent; the reason is shown.
    await userEvent.type(within(status).getByLabelText('Date'), '05/06/2026')
    await userEvent.click(within(status).getByRole('button', { name: 'Mark as Paid' }))
    expect(within(status).getByText('Enter the time too (HH:mm).')).toBeInTheDocument()
    expect(sent(spy, 'POST', '/api/reports/5/status')).toBeUndefined()

    // 05/06/2026 10:00 is 5 June at 10:00 local time, sent as that UTC instant.
    await userEvent.type(within(status).getByLabelText('Time'), '10:00')
    await userEvent.click(within(status).getByRole('button', { name: 'Mark as Paid' }))
    await vi.waitFor(() => expect(sent(spy, 'POST', '/api/reports/5/status')).toBeDefined())
    expect(JSON.parse(String(sent(spy, 'POST', '/api/reports/5/status')))).toEqual({ to: 'paid', at: new Date(2026, 5, 5, 10, 0).toISOString() })
  })

  it('offers only the allowed next statuses and the one-step undo', async () => {
    detailApi()
    renderAt('/reports/5')
    const status = await screen.findByRole('region', { name: 'Status' })
    const buttons = within(status).getAllByRole('button').map((b) => b.textContent).filter(Boolean) // not the calendar icon
    expect(buttons).toEqual(['Mark as Accepted', 'Mark as Duplicate', 'Mark as Rejected', 'Undo: back to Submitted'])
    expect(screen.getByText('Stored XSS', { selector: 'h1' })).toBeInTheDocument()
    expect(screen.getByText('8.2 · High')).toBeInTheDocument()
  })

  it('sends a transition, and translates a refused one', async () => {
    const spy = detailApi({
      'POST /api/reports/5/status': () => json(409, { detail: 'x', code: 'invalid_status_transition' }),
    })
    renderAt('/reports/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as Accepted' }))
    expect(JSON.parse(String(sent(spy, 'POST', '/api/reports/5/status')))).toEqual({ to: 'accepted' })
    expect(await screen.findByText('This status change is not allowed from the current status.')).toHaveAttribute('role', 'alert')
  })

  it('undo asks first and sends correction: true', async () => {
    const spy = detailApi({
      'POST /api/reports/5/status': () => json(200, { ...REPORT, status: 'submitted', triaged_at: null, next_statuses: ['triaged'], correction_to: 'draft' }),
    })
    renderAt('/reports/5')
    await userEvent.click(await screen.findByRole('button', { name: 'Undo: back to Submitted' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Undo the last status change?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Undo: back to Submitted' }))
    expect(JSON.parse(String(sent(spy, 'POST', '/api/reports/5/status')))).toEqual({ to: 'submitted', correction: true })
    expect(await screen.findByText('Status set back to Submitted.')).toBeInTheDocument()
  })

  it('lists evidence with a download link and uploads with multipart', async () => {
    const spy = detailApi({
      'POST /api/reports/5/attachments': () => json(422, { detail: 'x', code: 'attachment_content_mismatch' }),
    })
    renderAt('/reports/5')
    const link = await screen.findByRole('link', { name: 'Download poc.py' })
    expect(link).toHaveAttribute('href', '/api/reports/5/attachments/3/download')
    expect(link).toHaveAttribute('download')
    await userEvent.upload(screen.getByLabelText('Add evidence', { selector: 'input' }), new File(['<x>'], 'fake.png', { type: 'image/png' }))
    const body = sent(spy, 'POST', '/api/reports/5/attachments')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('file')).toBeInstanceOf(File)
    expect(await screen.findByText('fake.png: The file content does not match its extension.')).toBeInTheDocument()
  })

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru')
    detailApi()
    renderAt('/reports/5')
    expect(await screen.findByRole('button', { name: 'Отметить: Подтверждён' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Доказательства' })).toBeInTheDocument()
  })
})

describe('reports use the shared Markdown editor and view', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('the report form offers Markdown / Split / Preview on desktop, Split by default', async () => {
    localStorage.clear()
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('min-width'), media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    )
    mockApi({ 'GET /api/reports/5': () => json(200, REPORT) })
    renderAt('/reports/5/edit')
    const modes = await screen.findByRole('radiogroup', { name: 'Editor view' })
    expect(within(modes).getByRole('radio', { name: 'Split' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Report (Markdown)')).toHaveValue(REPORT.body_md)
    expect(screen.getByRole('region', { name: 'Preview' }).querySelector('h4')?.textContent).toBe('Steps') // "##" → h4
  })

  it('the report page renders the body as safe Markdown', async () => {
    mockApi({
      'GET /api/reports/5': () => json(200, { ...REPORT, body_md: '## Impact\n\nText <script>alert(1)</script>\n\n[go](javascript:alert(1))' }),
      'GET /api/reports/5/attachments': () => json(200, []),
    })
    renderAt('/reports/5')
    const body = await screen.findByRole('region', { name: 'Report' })
    expect(within(body).getByRole('heading', { name: 'Impact', level: 4 })).toBeInTheDocument()
    expect(body.querySelector('script')).toBeNull()
    expect(body.textContent).toContain('<script>alert(1)</script>')
    expect(within(body).getByText('go').closest('a')).toBeNull()
  })
})

