import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import LoginPage from './LoginPage'
import SetupPage from './SetupPage'

const PASSWORD = 'first owner passphrase'
const SESSION = { user: { id: 1, username: 'owner', last_login_at: null }, expires_at: '' }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockApi({ required = true, setup }: { required?: boolean; setup?: () => Response } = {}) {
  let isRequired = required
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/api/health') return json(200, { status: 'ok' })
    if (url === '/api/auth/me') return json(401, { detail: 'x', code: 'not_authenticated' })
    if (url === '/api/auth/setup' && (!init?.method || init.method === 'GET')) return json(200, { required: isRequired })
    if (url === '/api/auth/setup') {
      const res = setup ? setup() : json(201, SESSION)
      if (res.status === 201) isRequired = false
      return res
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { path: '/setup', element: <SetupPage /> },
      { path: '/', element: <p>home</p> },
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
}

async function fill(username: string, password: string, confirm: string) {
  const submit = await screen.findByRole('button', { name: i18n.t('setup.submit') })
  if (username) await userEvent.type(screen.getByLabelText(i18n.t('auth.username')), username)
  if (password) await userEvent.type(screen.getByLabelText(i18n.t('auth.password')), password)
  if (confirm) await userEvent.type(screen.getByLabelText(i18n.t('setup.confirm')), confirm)
  await userEvent.click(submit)
}

describe('first-run setup', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('an empty database sends the login page to setup', async () => {
    mockApi({ required: true })
    renderAt('/login')
    expect(await screen.findByRole('heading', { name: 'Create the owner account' })).toBeInTheDocument()
  })

  it('an existing account keeps the normal login page, and /setup redirects there', async () => {
    mockApi({ required: false })
    renderAt('/setup')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Repeat password')).not.toBeInTheDocument()
  })

  it('creates the owner, signs in, and keeps the password out of browser storage', async () => {
    const spy = mockApi()
    renderAt('/setup')
    await fill('Owner', PASSWORD, PASSWORD)
    expect(await screen.findByText('home')).toBeInTheDocument()

    const [, init] = spy.mock.calls.find(([url, i]) => url === '/api/auth/setup' && i?.method === 'POST')!
    expect(JSON.parse(String(init!.body))).toEqual({ username: 'Owner', password: PASSWORD, password_confirm: PASSWORD })
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie
    expect(stored).not.toContain(PASSWORD)
  })

  it('validates with translated messages before sending anything', async () => {
    const spy = mockApi()
    renderAt('/setup')
    await fill('', '', '')
    expect(screen.getByLabelText('Username')).toHaveFocus()
    expect(screen.getByLabelText('Username')).toHaveAccessibleDescription('This field is required.')

    await fill('owner', 'too short', 'different value')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Must be at least 12 characters.')

    await userEvent.clear(screen.getByLabelText('Password'))
    await fill('', PASSWORD, '')
    expect(screen.getByLabelText('Repeat password')).toHaveAccessibleDescription('Passwords do not match.')
    expect(spy.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false)
  })

  it.each([
    ['ru', 'Пароли не совпадают.', 'Создать учётную запись', 'Повторите пароль'],
    ['uz', 'Parollar mos kelmadi.', 'Hisob yaratish', 'Parolni takrorlang'],
  ] as const)('works in %s', async (lng, mismatch, submit, confirmLabel) => {
    await i18n.changeLanguage(lng)
    mockApi()
    renderAt('/setup')
    await fill('owner', PASSWORD, `${PASSWORD}!`)
    expect(screen.getByRole('button', { name: submit })).toBeInTheDocument()
    expect(screen.getByLabelText(confirmLabel)).toHaveAccessibleDescription(mismatch)
  })

  it('explains the loopback-only rule when opened from another machine', async () => {
    mockApi({
      setup: () => json(403, { detail: 'x', code: 'setup_local_only' }),
    })
    renderAt('/setup')
    await fill('owner', PASSWORD, PASSWORD)
    expect(await screen.findByText(/only be created on the computer that runs HexOps/)).toHaveAttribute('role', 'alert')
  })

  it('shows server field errors next to the field', async () => {
    mockApi({
      setup: () =>
        json(422, {
          detail: 'x',
          code: 'validation_error',
          errors: [{ field: 'password_confirm', code: 'password_mismatch', params: {} }],
        }),
    })
    renderAt('/setup')
    await fill('owner', PASSWORD, PASSWORD)
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  })

  it('switches to sign-in when someone else finished setup first', async () => {
    mockApi({ setup: () => json(409, { detail: 'x', code: 'setup_closed' }) })
    renderAt('/setup')
    await fill('owner', PASSWORD, PASSWORD)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
