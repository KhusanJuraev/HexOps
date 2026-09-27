import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import NoteDetailPage from './NoteDetailPage'
import NoteEditPage from './NoteEditPage'
import NoteNewPage from './NoteNewPage'
import NotesPage from './NotesPage'
import type { Note } from './types'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const page = (items: unknown[], total = items.length) => json(200, { items, total, page: 1, size: 20 })

const NOTE: Note = {
  id: 4,
  title: 'Recon dump',
  body_md: '# Hosts\n\n| host | port |\n|---|---|\n| a | 443 |\n\n```bash\nnmap -sV a\n```\n\n[x](javascript:alert(1)) <script>alert(1)</script>',
  project_id: 7,
  project_name: 'Acme',
  tags: ['recon', 'todo'],
  created_at: '2026-09-20T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
}

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function mockApi(handlers: Record<string, Handler>) {
  const all: Record<string, Handler> = {
    'GET /api/projects': () => json(200, { items: [{ id: 7, name: 'Acme' }], total: 1, page: 1, size: 100 }),
    'GET /api/notes/tags': () => json(200, [{ name: 'recon', count: 2 }, { name: 'todo', count: 1 }]),
    'GET /api/activity': () => page([]),
    ...handlers,
  }
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
      { path: '/notes', element: <NotesPage /> },
      { path: '/notes/new', element: <NoteNewPage /> },
      { path: '/notes/:noteId', element: <NoteDetailPage /> },
      { path: '/notes/:noteId/edit', element: <NoteEditPage /> },
      { path: '/elsewhere', element: <p>elsewhere</p> },
    ],
    { initialEntries: [path] },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <ToastProvider>
          <RouterProvider router={router} />
          <p>
            <button onClick={() => void router.navigate('/elsewhere')}>go elsewhere</button>
          </p>
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  return router
}

const bodyOf = (spy: ReturnType<typeof mockApi>, method: string, path: string) =>
  JSON.parse(String(spy.mock.calls.find(([u, i]) => new URL(String(u), 'http://x').pathname === path && i?.method === method)![1]!.body))

describe('notes list', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('sends several tag filters (AND) and keyword to the server', async () => {
    const spy = mockApi({ 'GET /api/notes': () => page([{ ...NOTE }]) })
    renderAt('/notes?tag=recon&tag=todo&q=nmap')
    expect(await screen.findByRole('link', { name: 'Recon dump' })).toHaveAttribute('href', '/notes/4')
    const url = new URL(String(spy.mock.calls.find(([u]) => String(u).startsWith('/api/notes?'))![0]), 'http://x')
    expect(url.searchParams.getAll('tag')).toEqual(['recon', 'todo'])
    expect(url.searchParams.get('q')).toBe('nmap')
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag filter todo' }))
    await vi.waitFor(() => {
      const last = new URL(String(spy.mock.calls.filter(([u]) => String(u).startsWith('/api/notes?')).at(-1)![0]), 'http://x')
      expect(last.searchParams.getAll('tag')).toEqual(['recon'])
    })
  })

  it('shows an honest empty state', async () => {
    mockApi({ 'GET /api/notes': () => page([]) })
    renderAt('/notes')
    expect(await screen.findByRole('heading', { name: 'No notes yet' })).toBeInTheDocument()
  })
})

describe('note editor', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('creates a note with tags and an optional project', async () => {
    const spy = mockApi({
      'POST /api/notes': (_u, init) => json(201, { ...NOTE, ...JSON.parse(String(init!.body)), id: 9 }),
      'GET /api/notes/9': () => json(200, NOTE),
    })
    const router = renderAt('/notes/new?project_id=7')
    await userEvent.type(await screen.findByLabelText('Title'), 'Cheat sheet')
    const tags = screen.getByLabelText('Tags')
    await userEvent.type(tags, 'Recon{enter}todo,SQLi{enter}')
    expect(screen.getByRole('button', { name: 'Remove tag recon' })).toBeInTheDocument()
    await userEvent.type(tags, '{backspace}') // removes the last tag
    await userEvent.type(tags, 'bad tag{enter}')
    expect(tags).toHaveAccessibleDescription(/Tags use letters, digits/)
    await userEvent.clear(tags)
    await userEvent.type(screen.getByLabelText('Note'), '## Payloads')
    await userEvent.click(screen.getByRole('button', { name: 'Create note' }))
    expect(bodyOf(spy, 'POST', '/api/notes')).toEqual({ title: 'Cheat sheet', body_md: '## Payloads', project_id: 7, tags: ['recon', 'todo'] })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/notes/9'))
  })

  it('keeps every edit after a server validation error', async () => {
    mockApi({
      'POST /api/notes': () => json(422, { detail: 'x', code: 'validation_error', errors: [{ field: 'tags', code: 'too_long', params: { max_length: 20 } }] }),
    })
    renderAt('/notes/new')
    await userEvent.type(await screen.findByLabelText('Title'), 'Keep me')
    await userEvent.type(screen.getByLabelText('Note'), 'long text')
    await userEvent.click(screen.getByRole('button', { name: 'Create note' }))
    expect(await screen.findByText('Too many items (maximum 20).')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Keep me')
    expect(screen.getByLabelText('Note')).toHaveValue('long text')
  })

  it('warns before leaving with unsaved edits; Stay keeps them, Leave discards', async () => {
    mockApi({})
    const router = renderAt('/notes/new')
    await userEvent.type(await screen.findByLabelText('Title'), 'Draft')
    await userEvent.click(screen.getByRole('button', { name: 'go elsewhere' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave without saving?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(router.state.location.pathname).toBe('/notes/new')
    expect(screen.getByLabelText('Title')).toHaveValue('Draft')

    await userEvent.click(screen.getByRole('button', { name: 'go elsewhere' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Leave without saving' }))
    expect(await screen.findByText('elsewhere')).toBeInTheDocument()
  })

  it('does not warn when nothing changed, or after saving', async () => {
    mockApi({
      'GET /api/notes/4': () => json(200, NOTE),
      'PUT /api/notes/4': () => json(200, { ...NOTE, title: 'New' }),
    })
    const router = renderAt('/notes/4/edit')
    expect(await screen.findByLabelText('Title')).toHaveValue('Recon dump')
    expect(screen.getByLabelText('Project (optional)')).toHaveValue('7')
    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'New')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/notes/4'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('note from an imported PDF draft', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('opens the new-note form prefilled, counts as unsaved, and creates a NEW note', async () => {
    const draft = { title: 'Imported notes', body_md: '# From PDF\n\n|a|b|\n|---|---|\n|1|2|\n' }
    const spy = mockApi({
      'POST /api/notes': (_u, init) => json(201, { ...NOTE, ...JSON.parse(String(init!.body)), id: 9 }),
      'GET /api/notes/9': () => json(200, NOTE),
    })
    const router = renderAt({ pathname: '/notes/new', state: { importDraft: draft } })
    expect(await screen.findByLabelText('Title')).toHaveValue('Imported notes')
    expect(screen.getByLabelText('Note')).toHaveValue(draft.body_md)
    expect(screen.getByText('From an imported PDF. Review, then save.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'go elsewhere' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument() // unsaved draft
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    await userEvent.click(screen.getByRole('button', { name: 'Create note' }))
    expect(bodyOf(spy, 'POST', '/api/notes')).toEqual({ title: 'Imported notes', body_md: draft.body_md, project_id: null, tags: [] })
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/notes/9'))
    expect(spy.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false) // nothing overwritten
  })

  it('ignores router state that is not a draft', async () => {
    mockApi({})
    renderAt({ pathname: '/notes/new', state: { importDraft: { title: 5 } } })
    expect(await screen.findByLabelText('Title')).toHaveValue('')
  })
})

describe('note detail', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('renders Markdown safely, with tags linking to the filtered list', async () => {
    mockApi({ 'GET /api/notes/4': () => json(200, NOTE) })
    renderAt('/notes/4')
    const body = await screen.findByRole('region', { name: 'Note' })
    expect(within(body).getByRole('heading', { name: 'Hosts', level: 3 })).toBeInTheDocument()
    expect(body.querySelector('table')).not.toBeNull()
    expect(body.querySelector('pre code.hljs')).not.toBeNull()
    expect(body.querySelector('script')).toBeNull()
    expect(within(body).getByText('x').closest('a')).toBeNull() // javascript: link dropped
    expect(screen.getByRole('link', { name: '#todo' })).toHaveAttribute('href', '/notes?tag=todo')
    expect(screen.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/projects/7')
  })

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru')
    mockApi({ 'GET /api/notes/4': () => json(200, NOTE) })
    renderAt('/notes/4')
    expect(await screen.findByRole('region', { name: 'Заметка' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument()
  })
})

