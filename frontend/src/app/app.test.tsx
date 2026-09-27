import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/app/queryClient'
import { ToastProvider } from '@/shared/components/ToastProvider'
import { AppShell } from '@/app/shell/AppShell'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import { RequireAuth } from '@/features/auth'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const SESSION = { user: { id: 1, username: 'researcher', last_login_at: null }, expires_at: '' }

function mockApi(me: () => Promise<Response> | Response, health: () => Promise<Response> | Response = () => json(200, { status: 'ok' })) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/auth/me') return me()
    if (url === '/api/health') return health()
    throw new Error(`unexpected fetch ${url}`)
  })
}

/** Alerts with content; the toast live region is always mounted but empty. */
const alerts = () => screen.queryAllByRole('alert').filter((a) => a.textContent)

function renderApp() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p>login screen</p> },
      {
        element: <RequireAuth />,
        children: [{ element: <AppShell />, children: [{ index: true, element: <p>private page</p> }] }],
      },
    ],
    { initialEntries: ['/'] },
  )
  render(
    <ThemeProvider>
      <QueryClientProvider client={createQueryClient()}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('RequireAuth and connection state', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('sends a 401 to the login screen', async () => {
    mockApi(() => json(401, { detail: 'Not authenticated', code: 'not_authenticated' }))
    renderApp()
    expect(await screen.findByText('login screen')).toBeInTheDocument()
  })

  it('shows an outage, not the login screen, when the backend is unreachable', async () => {
    mockApi(() => Promise.reject(new TypeError('Failed to fetch')))
    renderApp()
    expect(await screen.findByText('Can’t reach the HexOps server')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('login screen')).not.toBeInTheDocument()
  })

  it('treats a proxy error page (bare 500) as unreachable', async () => {
    mockApi(() => new Response('', { status: 500 }))
    renderApp()
    expect(await screen.findByText('Can’t reach the HexOps server')).toBeInTheDocument()
  })

  it('distinguishes a database outage', async () => {
    mockApi(() => json(503, { detail: 'Database unreachable', code: 'database_unavailable' }))
    renderApp()
    expect(await screen.findByText('The database is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('login screen')).not.toBeInTheDocument()
  })

  it('shows Connected in the shell when the backend answers', async () => {
    mockApi(() => json(200, SESSION))
    renderApp()
    expect(await screen.findByText('private page')).toBeInTheDocument()
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(alerts()).toEqual([])
  })

  it('keeps the session but shows an outage banner when only health fails', async () => {
    mockApi(
      () => json(200, SESSION),
      () => Promise.reject(new TypeError('Failed to fetch')),
    )
    renderApp()
    expect(await screen.findByText('private page')).toBeInTheDocument()
    expect(await screen.findByText('Can’t reach the HexOps server')).toBeInTheDocument()
    expect(alerts()).toHaveLength(1)
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })

  it('renders the shell in Russian', async () => {
    await i18n.changeLanguage('ru')
    mockApi(() => json(200, SESSION))
    renderApp()
    expect(await screen.findByText('private page')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Основная навигация' })
    for (const label of ['Обзор', 'Отчёты', 'Проекты', 'Заметки', 'Настройки']) {
      expect(nav).toHaveTextContent(label)
    }
    expect(screen.getByRole('link', { name: 'Перейти к основному содержимому' })).toHaveAttribute('href', '#main')
    expect(await screen.findByText('Подключено')).toBeInTheDocument()
  })

  it('returns to the login screen after signing out', async () => {
    let signedIn = true
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url === '/api/health') return json(200, { status: 'ok' })
      if (url === '/api/auth/logout') {
        signedIn = false
        return new Response(null, { status: 204 })
      }
      if (url === '/api/auth/me') return signedIn ? json(200, SESSION) : json(401, { detail: 'x', code: 'not_authenticated' })
      throw new Error(`unexpected fetch ${url}`)
    })
    renderApp()
    expect(await screen.findByText('private page')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Signed in as' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    expect(await screen.findByText('login screen')).toBeInTheDocument()
    expect(screen.queryByText('private page')).not.toBeInTheDocument()
  })
})
