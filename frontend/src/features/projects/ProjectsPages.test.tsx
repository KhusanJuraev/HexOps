import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import ProjectDetailPage from './ProjectDetailPage'
import ProjectEditPage from './ProjectEditPage'
import ProjectNewPage from './ProjectNewPage'
import ProjectsPage from './ProjectsPage'
import type { ActivityEvent } from '@/features/activity'

import type { Project, ProjectListItem } from './types'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const PROJECT: Project = {
  id: 7,
  name: 'Example Corp',
  type: 'bounty_program',
  status: 'paused',
  start_date: '2026-09-01',
  description: 'Line one\nLine two',
  scope: [
    { kind: 'wildcard', value: '*.example.com', note: 'main' },
    { kind: 'cidr', value: '10.0.0.0/24', note: '' },
  ],
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-02T10:00:00Z',
}
const ITEM: ProjectListItem = { ...PROJECT, scope_count: 2 }
const EVENTS: ActivityEvent[] = [
  { id: 3, occurred_at: '2026-09-02T10:00:00Z', entity_type: 'project', entity_id: 7, project_id: 7, actor: 'researcher', action: 'project.updated', details: { fields: ['name', 'scope'] } },
  { id: 2, occurred_at: '2026-09-02T09:00:00Z', entity_type: 'project', entity_id: 7, project_id: 7, actor: 'researcher', action: 'project.status_changed', details: { from: 'active', to: 'paused' } },
  { id: 1, occurred_at: '2026-09-01T10:00:00Z', entity_type: 'project', entity_id: 7, project_id: 7, actor: 'researcher', action: 'project.created', details: { name: 'Example Corp' } },
]

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockApi(handlers: Record<string, Handler>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input), 'http://127.0.0.1')
    const key = `${init?.method ?? 'GET'} ${url.pathname}`
    const handler = handlers[key]
    if (!handler) throw new Error(`unexpected ${key}`)
    return handler(url, init)
  })
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/projects', element: <ProjectsPage /> },
      { path: '/projects/new', element: <ProjectNewPage /> },
      { path: '/projects/:projectId', element: <ProjectDetailPage /> },
      { path: '/projects/:projectId/edit', element: <ProjectEditPage /> },
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

const page = (items: ProjectListItem[], total = items.length, pageNo = 1) => json(200, { items, total, page: pageNo, size: 20 })

describe('projects list', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows an honest empty state with no projects', async () => {
    mockApi({ 'GET /api/projects': () => page([]) })
    renderAt('/projects')
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'New project' }).length).toBeGreaterThan(0)
  })

  it('renders rows, and sends filters from the URL to the server', async () => {
    const spy = mockApi({ 'GET /api/projects': () => page([ITEM]) })
    renderAt('/projects?type=bounty_program&sort=name&order=asc&page=1')
    const table = await screen.findByRole('table')
    expect(within(table).getByRole('link', { name: 'Example Corp' })).toHaveAttribute('href', '/projects/7')
    expect(within(table).getByText('Paused')).toBeInTheDocument()
    const url = new URL(String(spy.mock.calls[0][0]), 'http://x')
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'bounty_program', sort: 'name', order: 'asc', size: '20' })
  })

  it('debounces the search box: one request after typing stops', async () => {
    const spy = mockApi({ 'GET /api/projects': (url) => page(url.searchParams.get('q') ? [] : [ITEM]) })
    renderAt('/projects')
    await screen.findByRole('table')
    const before = spy.mock.calls.length
    await userEvent.type(screen.getByLabelText('Search by name'), 'acme')
    expect(await screen.findByRole('heading', { name: 'No matching projects' })).toBeInTheDocument()
    const searches = spy.mock.calls.slice(before).map(([u]) => new URL(String(u), 'http://x').searchParams.get('q'))
    expect(searches).toEqual(['acme'])
    await userEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0])
    expect(await screen.findByRole('table')).toBeInTheDocument()
  })

  it('paginates on the server', async () => {
    const spy = mockApi({
      'GET /api/projects': (url) => page([{ ...ITEM, name: `Page ${url.searchParams.get('page') ?? 1}` }], 45, Number(url.searchParams.get('page') ?? 1)),
    })
    renderAt('/projects')
    expect(await screen.findByText('1–20 of 45')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('21–40 of 45')).toBeInTheDocument()
    expect(new URL(String(spy.mock.calls.at(-1)![0]), 'http://x').searchParams.get('page')).toBe('2')
  })
})

describe('project form', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('creates a project with the scope exactly as typed, in order', async () => {
    const spy = mockApi({
      'POST /api/projects': (_u, init) => json(201, { ...PROJECT, ...JSON.parse(String(init!.body)), id: 9 }),
      'GET /api/projects/9': () => json(200, PROJECT),
      'GET /api/activity': () => json(200, { items: [], total: 0, page: 1, size: 20 }),
    })
    const router = renderAt('/projects/new')
    await userEvent.type(await screen.findByLabelText('Name'), 'Acme')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'pentest_client')
    await userEvent.click(screen.getByRole('button', { name: 'Add asset' }))
    await userEvent.type(screen.getAllByLabelText('Value')[0], 'API.Acme.example')
    await userEvent.click(screen.getByRole('button', { name: 'Add asset' }))
    await userEvent.selectOptions(screen.getAllByLabelText('Kind')[1], 'ip')
    await userEvent.type(screen.getAllByLabelText('Value')[1], '192.0.2.1')
    await userEvent.type(screen.getAllByLabelText('Note (optional)')[1], 'jump host')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))

    const [, init] = spy.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(String(init!.body))).toEqual({
      name: 'Acme',
      type: 'pentest_client',
      status: 'active',
      start_date: null,
      description: '',
      scope: [
        { kind: 'domain', value: 'API.Acme.example', note: '' },
        { kind: 'ip', value: '192.0.2.1', note: 'jump host' },
      ],
    })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/projects/9'))
    expect(await screen.findByText('Project created.')).toBeInTheDocument()
  })

  it('refuses surrounding spaces instead of trimming, before sending', async () => {
    const spy = mockApi({})
    renderAt('/projects/new')
    await userEvent.type(await screen.findByLabelText('Name'), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: 'Add asset' }))
    await userEvent.type(screen.getAllByLabelText('Value')[0], ' a.example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(screen.getAllByLabelText('Value')[0]).toHaveAccessibleDescription(
      'Remove spaces at the start or end. Values are saved exactly as typed.',
    )
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows server scope errors on the right row', async () => {
    mockApi({
      'POST /api/projects': () =>
        json(422, {
          detail: 'x',
          code: 'validation_error',
          errors: [
            { field: 'scope.1.value', code: 'scope_cidr_host_bits', params: {} },
            { field: 'start_date', code: 'date_out_of_range', params: {} },
          ],
        }),
    })
    renderAt('/projects/new')
    await userEvent.type(await screen.findByLabelText('Name'), 'Acme')
    for (const value of ['a.example.com', '10.0.0.5/24']) {
      await userEvent.click(screen.getByRole('button', { name: 'Add asset' }))
      await userEvent.type(screen.getAllByLabelText('Value').at(-1)!, value)
    }
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    const [first, second] = screen.getAllByLabelText('Value')
    expect(await screen.findByText('The range must start at its network address, e.g. 10.0.0.0/24.')).toBeInTheDocument()
    expect(second).toHaveAttribute('aria-invalid', 'true')
    expect(first).not.toHaveAttribute('aria-invalid')
    expect(screen.getByLabelText('Start date')).toHaveAccessibleDescription('Choose a date between 1990 and 2100.')
    expect(screen.getByText('Please correct the highlighted fields.')).toHaveAttribute('role', 'alert')
  })

  it('edits an existing project with its current values', async () => {
    const spy = mockApi({
      'GET /api/projects/7': () => json(200, PROJECT),
      'PUT /api/projects/7': (_u, init) => json(200, { ...PROJECT, ...JSON.parse(String(init!.body)) }),
      'GET /api/activity': () => json(200, { items: [], total: 0, page: 1, size: 20 }),
    })
    renderAt('/projects/7/edit')
    expect(await screen.findByLabelText('Name')).toHaveValue('Example Corp')
    expect(screen.getAllByLabelText('Value').map((i) => (i as HTMLInputElement).value)).toEqual(['*.example.com', '10.0.0.0/24'])
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'closed')
    await userEvent.click(screen.getByRole('button', { name: 'Move asset 2 up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const [, init] = spy.mock.calls.find(([, i]) => i?.method === 'PUT')!
    const sent = JSON.parse(String(init!.body))
    expect(sent.status).toBe('closed')
    expect(sent.scope.map((s: { value: string }) => s.value)).toEqual(['10.0.0.0/24', '*.example.com'])
    expect(sent.start_date).toBe('2026-09-01') // unchanged, never shifted a day
  })

  it('shows and edits the start date day first, and blocks an impossible one', async () => {
    const spy = mockApi({
      'GET /api/projects/7': () => json(200, PROJECT),
      'PUT /api/projects/7': (_u, init) => json(200, { ...PROJECT, ...JSON.parse(String(init!.body)) }),
      'GET /api/activity': () => json(200, { items: [], total: 0, page: 1, size: 20 }),
    })
    renderAt('/projects/7/edit')
    const field = await screen.findByLabelText('Start date')
    expect(field).toHaveValue('01/09/2026') // stored 2026-09-01
    await userEvent.clear(field)
    await userEvent.type(field, '31/06/2026') // June has 30 days
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(field).toHaveFocus()
    expect(field).toHaveAccessibleDescription('This date does not exist (check the day and month).')
    expect(spy.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false)

    await userEvent.clear(field)
    await userEvent.type(field, '05/06/2026')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(spy.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true))
    const [, init] = spy.mock.calls.find(([, i]) => i?.method === 'PUT')!
    expect(JSON.parse(String(init!.body)).start_date).toBe('2026-06-05') // 5 June, not 6 May
  })
})

describe('project detail', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows scope, linked reports and notes, and translated activity', async () => {
    mockApi({
      'GET /api/projects/7': () => json(200, PROJECT),
      'GET /api/reports': (url) => {
        expect(url.searchParams.get('project_id')).toBe('7')
        return json(200, { items: [], total: 0, page: 1, size: 10 })
      },
      'GET /api/notes': (url) => {
        expect(url.searchParams.get('project_id')).toBe('7')
        return json(200, { items: [{ id: 3, title: 'Recon dump', project_id: 7, project_name: 'Example Corp', tags: ['recon'], created_at: '', updated_at: '' }], total: 1, page: 1, size: 10 })
      },
      'GET /api/activity': (url) => {
        expect(url.searchParams.get('project_id')).toBe('7')
        return json(200, { items: EVENTS, total: 3, page: 1, size: 20 })
      },
    })
    renderAt('/projects/7')
    expect(await screen.findByRole('heading', { level: 1, name: 'Example Corp' })).toBeInTheDocument()
    const scope = screen.getByRole('region', { name: 'Scope (2)' })
    expect(within(scope).getByText('*.example.com')).toBeInTheDocument()
    expect(within(scope).getByText('Wildcard domain')).toBeInTheDocument()
    const reports = screen.getByRole('region', { name: 'Reports' })
    expect(await within(reports).findByText('No reports for this project yet.')).toBeInTheDocument()
    expect(within(reports).getByRole('link', { name: 'New report for this project' })).toHaveAttribute('href', '/reports/new?project_id=7')
    const notes = screen.getByRole('region', { name: 'Notes' })
    expect(await within(notes).findByRole('link', { name: 'Recon dump' })).toHaveAttribute('href', '/notes/3')
    expect(within(notes).getByRole('link', { name: '#recon' })).toHaveAttribute('href', '/notes?tag=recon')
    expect(within(notes).getByRole('link', { name: 'New note for this project' })).toHaveAttribute('href', '/notes/new?project_id=7')
    const activity = screen.getByRole('region', { name: 'Activity' })
    expect(await within(activity).findByText('Updated: name, scope')).toBeInTheDocument()
    expect(within(activity).getByText('Status changed: Active → Paused')).toBeInTheDocument()
    expect(within(activity).getByText('Project created')).toBeInTheDocument()
  })

  it('an activity failure stays inside its section', async () => {
    mockApi({
      'GET /api/projects/7': () => json(200, PROJECT),
      'GET /api/activity': () => json(500, { detail: 'x', code: 'internal_error' }),
      'GET /api/reports': () => json(200, { items: [], total: 0, page: 1, size: 10 }),
      'GET /api/notes': () => json(200, { items: [], total: 0, page: 1, size: 10 }),
    })
    renderAt('/projects/7')
    const activity = await screen.findByRole('region', { name: 'Activity' })
    expect(await within(activity).findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Example Corp' })).toBeInTheDocument()
  })

  it('unknown or invalid ids show "not found"', async () => {
    mockApi({ 'GET /api/projects/404': () => json(404, { detail: 'x', code: 'project_not_found' }) })
    renderAt('/projects/404')
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
  })

  it('renders in Uzbek', async () => {
    await i18n.changeLanguage('uz')
    mockApi({
      'GET /api/projects/7': () => json(200, PROJECT),
      'GET /api/reports': () => json(200, { items: [], total: 0, page: 1, size: 10 }),
      'GET /api/notes': () => json(200, { items: [], total: 0, page: 1, size: 10 }),
      'GET /api/activity': () => json(200, { items: EVENTS, total: 3, page: 1, size: 20 }),
    })
    renderAt('/projects/7')
    expect(await screen.findByRole('region', { name: 'Harakatlar tarixi' })).toBeInTheDocument()
    expect(screen.getByText('Toʻxtatilgan')).toBeInTheDocument()
    expect(await screen.findByText('Holat oʻzgardi: Faol → Toʻxtatilgan')).toBeInTheDocument()
  })
})
