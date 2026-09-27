import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import LoginPage from './LoginPage'

function renderLogin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <p>home</p> },
    ],
    { initialEntries: ['/login'] },
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
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const NOT_AUTHENTICATED = { detail: 'Not authenticated', code: 'not_authenticated' }

/** Route fetch by path; /me answers 401 and /health 200 unless overridden. */
function mockApi(routes: Record<string, () => Promise<Response> | Response>) {
  const all = {
    '/api/auth/me': () => json(401, NOT_AUTHENTICATED),
    '/api/health': () => json(200, { status: 'ok' }),
    '/api/auth/setup': () => json(200, { required: false }),
    ...routes,
  }
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const handler = all[String(input) as keyof typeof all]
    if (!handler) throw new Error(`unexpected fetch ${String(input)}`)
    return handler()
  })
}

/** Alerts with content; the toast live region is always mounted but empty. */
const alerts = () => screen.queryAllByRole('alert').filter((a) => a.textContent)

const loginCalls = (spy: ReturnType<typeof mockApi>) =>
  spy.mock.calls.filter(([url]) => String(url) === '/api/auth/login').length

async function fillAndSubmit(username: string, password: string, button = 'Sign in') {
  if (username) await userEvent.type(await screen.findByLabelText(i18n.t('auth.username')), username)
  if (password) await userEvent.type(screen.getByLabelText(i18n.t('auth.password')), password)
  await userEvent.click(screen.getByRole('button', { name: button }))
}

describe('LoginPage', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows a generic error on wrong credentials and clears the password', async () => {
    mockApi({
      '/api/auth/login': () => json(401, { detail: 'Invalid username or password', code: 'invalid_credentials' }),
    })
    renderLogin()
    await fillAndSubmit('researcher', 'wrong-password')
    expect(await screen.findByText('Incorrect username or password.')).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('redirects home after a successful login', async () => {
    const session = { user: { id: 1, username: 'researcher', last_login_at: null }, expires_at: '' }
    mockApi({ '/api/auth/login': () => json(200, session) })
    renderLogin()
    await fillAndSubmit('researcher', 'correct horse battery')
    expect(await screen.findByText('home')).toBeInTheDocument()
  })

  it('validates empty fields with translated messages and focuses the first one', async () => {
    const spy = mockApi({})
    renderLogin()
    await screen.findByLabelText('Username')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const username = screen.getByLabelText('Username')
    expect(username).toHaveFocus()
    expect(username).toHaveAttribute('aria-invalid', 'true')
    expect(username).toHaveAccessibleDescription('This field is required.')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('This field is required.')
    expect(loginCalls(spy)).toBe(0)

    await userEvent.type(username, 'r')
    expect(username).not.toHaveAttribute('aria-invalid')
  })

  it('explains the username format instead of calling it wrong credentials', async () => {
    const spy = mockApi({})
    renderLogin()
    await fillAndSubmit('a b', 'whatever')
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription(
      'Use 3–64 characters: Latin letters, digits, “_”, “.” or “-”.',
    )
    expect(loginCalls(spy)).toBe(0)
  })

  it('shows server-side field errors next to the field', async () => {
    mockApi({
      '/api/auth/login': () =>
        json(422, {
          detail: 'Request validation failed',
          code: 'validation_error',
          errors: [{ field: 'password', code: 'string_too_long', params: { max_length: 256 } }],
        }),
    })
    renderLogin()
    await fillAndSubmit('researcher', 'x')
    expect(await screen.findByText('Must be at most 256 characters.')).toBeInTheDocument()
    expect(alerts()).toEqual([])
  })

  it('reports an unreachable backend as an outage, not as bad credentials', async () => {
    mockApi({
      '/api/health': () => Promise.reject(new TypeError('Failed to fetch')),
      '/api/auth/login': () => Promise.reject(new TypeError('Failed to fetch')),
    })
    renderLogin()
    await fillAndSubmit('researcher', 'correct horse battery')
    expect(await screen.findByText('Can’t reach the HexOps server', { selector: '[role=alert]' })).toBeInTheDocument()
    expect(screen.queryByText('Incorrect username or password.')).not.toBeInTheDocument()
  })

  it('renders and validates in Russian', async () => {
    mockApi({})
    await i18n.changeLanguage('ru')
    renderLogin()
    expect(await screen.findByLabelText('Имя пользователя')).toBeInTheDocument()
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Войти' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
    expect(screen.getByLabelText('Имя пользователя')).toHaveAccessibleDescription('Обязательное поле.')
  })

  it('renders in Uzbek', async () => {
    mockApi({})
    await i18n.changeLanguage('uz')
    renderLogin()
    expect(await screen.findByLabelText('Foydalanuvchi nomi')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kirish' })).toBeInTheDocument()
  })
})
