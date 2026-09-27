// Integration: Settings → Security form, auth guard and login notice together.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequireAuth } from '@/features/auth'
import LoginPage from '@/features/auth/LoginPage'
import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import SettingsPage from '@/features/settings/SettingsPage'

const CURRENT = 'current passphrase'
const NEW = 'a brand new passphrase'
const SESSION = { user: { id: 1, username: 'researcher', last_login_at: null }, expires_at: '' }

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function mockApi(change: () => Response = () => new Response(null, { status: 204 })) {
  let signedIn = true
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    if (url === '/api/health') return json(200, { status: 'ok' })
    if (url === '/api/auth/setup') return json(200, { required: false })
    if (url === '/api/auth/me') return signedIn ? json(200, SESSION) : json(401, { detail: 'x', code: 'not_authenticated' })
    if (url === '/api/auth/password') {
      const res = change()
      if (res.status === 204) signedIn = false
      return res
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { element: <RequireAuth />, children: [{ path: '/settings', element: <SettingsPage /> }] },
    ],
    { initialEntries: ['/settings'] },
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

// Settings also has the username form (with its own "Current password"): stay in this form.
const passwordForm = () => within(screen.getByRole('form', { name: i18n.t('security.changePassword') }))
const field = (key: 'current' | 'new' | 'confirm') => passwordForm().getByLabelText(i18n.t(`security.${key}`))

async function submit(current: string, next: string, confirm: string) {
  const form = await screen.findByRole('form', { name: i18n.t('security.changePassword') })
  if (current) await userEvent.type(field('current'), current)
  if (next) await userEvent.type(field('new'), next)
  if (confirm) await userEvent.type(field('confirm'), confirm)
  await userEvent.click(within(form).getByRole('button', { name: i18n.t('security.submit') }))
}

const posts = (spy: ReturnType<typeof mockApi>) => spy.mock.calls.filter(([u]) => String(u) === '/api/auth/password')

describe('Settings → Security → Change password', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('validates on the client with translated messages and sends nothing', async () => {
    const spy = mockApi()
    renderSettings()
    await submit('', '', '')
    expect(field('current')).toHaveFocus()
    expect(field('current')).toHaveAccessibleDescription('This field is required.')

    await submit(CURRENT, 'short', 'short')
    expect(field('new')).toHaveAccessibleDescription('Must be at least 12 characters.')

    await userEvent.clear(field('new'))
    await userEvent.clear(field('confirm'))
    await submit('', CURRENT, CURRENT)
    expect(field('new')).toHaveAccessibleDescription('Choose a password different from the current one.')

    await userEvent.clear(field('new'))
    await userEvent.clear(field('confirm'))
    await submit('', NEW, `${NEW}!`)
    expect(field('confirm')).toHaveAccessibleDescription('Passwords do not match.')
    expect(posts(spy)).toHaveLength(0)
  })

  it('show/hide toggle switches every password field and works from the keyboard', async () => {
    mockApi()
    renderSettings()
    await screen.findByRole('form', { name: i18n.t('security.changePassword') })
    const toggle = passwordForm().getByRole('checkbox', { name: 'Show passwords' })
    for (const key of ['current', 'new', 'confirm'] as const) expect(field(key)).toHaveAttribute('type', 'password')
    toggle.focus()
    await userEvent.keyboard(' ')
    expect(toggle).toBeChecked()
    for (const key of ['current', 'new', 'confirm'] as const) expect(field(key)).toHaveAttribute('type', 'text')
    await userEvent.click(toggle)
    expect(field('current')).toHaveAttribute('type', 'password')
  })

  it('a wrong current password keeps the session and points at the field', async () => {
    mockApi(() =>
      json(422, {
        detail: 'x',
        code: 'validation_error',
        errors: [{ field: 'current_password', code: 'invalid_current_password', params: {} }],
      }),
    )
    renderSettings()
    await submit('wrong current', NEW, NEW)
    expect(await screen.findByText('The current password is incorrect.')).toBeInTheDocument()
    expect(field('current')).toHaveValue('')
    expect(field('current')).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument() // still signed in
  })

  it('shows the server reuse rejection next to the new password', async () => {
    mockApi(() =>
      json(422, {
        detail: 'x',
        code: 'validation_error',
        errors: [{ field: 'new_password', code: 'password_reused', params: {} }],
      }),
    )
    renderSettings()
    await submit(CURRENT, NEW, NEW)
    expect(await screen.findByText('Choose a password different from the current one.')).toBeInTheDocument()
  })

  it('reports throttling as a form error', async () => {
    mockApi(() => new Response(JSON.stringify({ detail: 'x', code: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '120' } }))
    renderSettings()
    await submit(CURRENT, NEW, NEW)
    expect(await screen.findByText('Too many attempts. Try again in 120 s.')).toHaveAttribute('role', 'alert')
  })

  it('success signs out and shows the translated notice on the login page', async () => {
    const spy = mockApi()
    renderSettings()
    await submit(CURRENT, NEW, NEW)

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Password changed. Sign in with your new password.')).toHaveAttribute('role', 'status')

    const [, init] = posts(spy)[0]
    expect(JSON.parse(String(init!.body))).toEqual({ current_password: CURRENT, new_password: NEW, new_password_confirm: NEW })
    expect(String(posts(spy)[0][0])).not.toContain(NEW) // not in the URL
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie
    expect(stored).not.toContain(NEW)
    expect(stored).not.toContain(CURRENT)
  })

  it.each([
    ['ru', 'Пароль изменён. Войдите с новым паролем.', 'Сменить пароль'],
    ['uz', 'Parol almashtirildi. Yangi parol bilan kiring.', 'Parolni almashtirish'],
  ] as const)('works in %s', async (lng, notice, button) => {
    await i18n.changeLanguage(lng)
    mockApi()
    renderSettings()
    await screen.findByRole('button', { name: button })
    await submit(CURRENT, NEW, NEW)
    expect(await screen.findByText(notice)).toBeInTheDocument()
  })
})
