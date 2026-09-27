import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/shared/i18n'

import SearchPage from './SearchPage'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const HITS = {
  items: [
    { kind: 'report', id: 5, title: 'SQLi in search', snippet: '…the sqli payload <script>x</script>…', project_id: 1, project_name: 'Acme', updated_at: '2026-09-01T10:00:00Z', severity: 'high', status: 'triaged', tags: null },
    { kind: 'note', id: 9, title: 'Recon', snippet: 'sqlmap run', project_id: null, project_name: null, updated_at: '2026-09-02T10:00:00Z', severity: null, status: null, tags: ['recon'] },
  ],
  total: 2,
  page: 1,
  size: 20,
  terms: ['sqli'],
}

function mockApi(search: (url: URL) => Response = () => json(200, HITS)) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://x')
    if (url.pathname === '/api/notes/tags') return json(200, [{ name: 'recon', count: 1 }])
    if (url.pathname === '/api/search') return search(url)
    throw new Error(`unexpected ${url.pathname}`)
  })
}

function renderAt(path: string) {
  const router = createMemoryRouter([{ path: '/search', element: <SearchPage /> }], { initialEntries: [path] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const searches = (spy: ReturnType<typeof mockApi>) =>
  spy.mock.calls.map(([u]) => new URL(String(u), 'http://x')).filter((u) => u.pathname === '/api/search')

describe('SearchPage', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('asks for a query first and sends nothing', async () => {
    const spy = mockApi()
    renderAt('/search')
    expect(await screen.findByRole('heading', { name: 'Search your workspace' })).toBeInTheDocument()
    expect(searches(spy)).toHaveLength(0)
  })

  it('sends one debounced request after typing, and keeps the query in the URL', async () => {
    const spy = mockApi()
    const router = renderAt('/search')
    await userEvent.type(screen.getByLabelText('Search for'), 'sqli payload')
    expect(await screen.findByText('Results: 2')).toBeInTheDocument()
    expect(searches(spy).map((u) => u.searchParams.get('q'))).toEqual(['sqli payload'])
    expect(router.state.location.search).toBe('?q=sqli+payload')
  })

  it('shows hits with safe highlighting, kinds and links', async () => {
    mockApi()
    renderAt('/search?q=sqli')
    const link = await screen.findByRole('link', { name: /SQLi in search/ })
    expect(link).toHaveAttribute('href', '/reports/5')
    expect(link.querySelector('mark')?.textContent).toBe('SQLi')
    expect(screen.getByRole('link', { name: 'Recon' })).toHaveAttribute('href', '/notes/9')
    expect(screen.getByText('Triaged')).toBeInTheDocument()
    expect(document.querySelector('main script, script:not([src])')).toBeNull()
    expect(screen.getByText(/<script>x<\/script>/)).toBeInTheDocument()
  })

  it('sends kind and tag filters to the server', async () => {
    const spy = mockApi()
    renderAt('/search?q=sqli')
    await screen.findByText('Results: 2')
    await userEvent.selectOptions(screen.getByLabelText('Look in'), 'note')
    await userEvent.selectOptions(screen.getByLabelText('Note tag'), 'recon')
    await vi.waitFor(() => {
      const last = searches(spy).at(-1)!
      expect(last.searchParams.get('kind')).toBe('note')
      expect(last.searchParams.getAll('tag')).toEqual(['recon'])
    })
  })

  it('shows an empty state and translated errors', async () => {
    mockApi(() => json(200, { items: [], total: 0, page: 1, size: 20, terms: [] }))
    renderAt('/search?q=zzz')
    expect(await screen.findByRole('heading', { name: 'Nothing found' })).toBeInTheDocument()
  })

  it('reports a timeout with a useful message', async () => {
    mockApi(() => json(422, { detail: 'x', code: 'search_timeout' }))
    renderAt('/search?q=zzz')
    expect(await screen.findByText('The search took too long. Use more specific words.')).toBeInTheDocument()
  })

  it('renders in Uzbek', async () => {
    await i18n.changeLanguage('uz')
    mockApi()
    renderAt('/search')
    expect(await screen.findByLabelText('Nimani qidirish')).toBeInTheDocument()
  })
})
