// Integration: Settings → Account username form, auth guard and login notice together (D-91).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { RequireAuth } from '@/features/auth'
import LoginPage from '@/features/auth/LoginPage'
import SettingsPage from '@/features/settings/SettingsPage'
import { ToastProvider } from '@/shared/components/ToastProvider'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

const CURRENT = 'current passphrase'
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
    if (url === '/api/auth/username') {
      const res = change()
      if (res.status === 204) signedIn = false
      return res
    }
    throw new Error(`unexpected fetch ${url}`)
  })
}

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: '/login', element: <LoginPage /> },
      { element: <RequireAuth />, children: [{ path: '/settings', element: <SettingsPage /> }] },
    ],
    { initialEntries: ['/settings'] },
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
}

const form = () => within(screen.getByRole('form', { name: i18n.t('account.changeUsername') }))
const posts = (spy: ReturnType<typeof mockApi>) => spy.mock.calls.filter(([u]) => String(u) === '/api/auth/username')

async function submit(name: string, password: string) {
  const f = within(await screen.findByRole('form', { name: i18n.t('account.changeUsername') }))
  if (name) await userEvent.type(f.getByLabelText(i18n.t('account.newUsername')), name)
  if (password) await userEvent.type(f.getByLabelText(i18n.t('security.current')), password)
  await userEvent.click(f.getByRole('button', { name: i18n.t('account.save') }))
}

describe('Settings → Account: change username', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('shows the current username', async () => {
    mockApi()
    renderSettings()
    await screen.findByRole('form', { name: 'Change username' })
    expect(form().getByText('researcher')).toBeInTheDocument()
    expect(form().getByText(/signed out on every device/)).toBeInTheDocument()
  })

  it.each([
    ['', CURRENT, 'new_username', 'This field is required.'],
    ['a b', CURRENT, 'new_username', '3–64 characters: letters, digits, “.”, “_” and “-”. Letter case does not matter.'],
    ['ReSeArChEr', CURRENT, 'new_username', 'This is already your username (letter case does not matter).'],
    ['hunter', '', 'username_current_password', 'This field is required.'],
  ])('validates %j / %j on the client and sends nothing', async (name, password, id, message) => {
    const spy = mockApi()
    renderSettings()
    await submit(name, password)
    const input = document.getElementById(id)!
    expect(input).toHaveAccessibleDescription(message)
    expect(input).toHaveFocus()
    expect(posts(spy)).toHaveLength(0)
  })

  it('a wrong current password keeps the session, clears the field and points at it', async () => {
    mockApi(() => json(422, { detail: 'x', code: 'validation_error', errors: [{ field: 'current_password', code: 'invalid_current_password' }] }))
    renderSettings()
    await submit('hunter', 'not my password')
    const password = await screen.findByLabelText('Current password', { selector: '#username_current_password' })
    expect(await within(password.parentElement!).findByText('The current password is incorrect.')).toBeInTheDocument()
    expect(password).toHaveValue('')
    expect(password).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument() // still signed in
  })

  it('shows a taken name next to the field, and throttling as a form error', async () => {
    mockApi(() => json(422, { detail: 'x', code: 'validation_error', errors: [{ field: 'new_username', code: 'username_taken' }] }))
    renderSettings()
    await submit('hunter', CURRENT)
    expect(await screen.findByText('This username is taken.')).toBeInTheDocument()
  })

  it('reports throttling as a form error', async () => {
    mockApi(() => new Response(JSON.stringify({ detail: 'x', code: 'rate_limited' }), { status: 429, headers: { 'Retry-After': '300' } }))
    renderSettings()
    await submit('hunter', CURRENT)
    expect(await screen.findByText('Too many attempts. Try again in 300 s.')).toHaveAttribute('role', 'alert')
  })

  it('show/hide works from the keyboard for this form only', async () => {
    mockApi()
    renderSettings()
    await screen.findByRole('form', { name: 'Change username' })
    const password = form().getByLabelText('Current password')
    expect(password).toHaveAttribute('type', 'password')
    form().getByRole('checkbox', { name: 'Show passwords' }).focus()
    await userEvent.keyboard(' ')
    expect(password).toHaveAttribute('type', 'text')
  })

  it('success signs out and the login page says to use the new name', async () => {
    const spy = mockApi()
    renderSettings()
    await submit('Hunter', CURRENT)
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Username changed. Sign in with the new username and your current password.')).toHaveAttribute('role', 'status')
    const [, init] = posts(spy)[0]
    expect(JSON.parse(String(init!.body))).toEqual({ new_username: 'Hunter', current_password: CURRENT })
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie
    expect(stored).not.toContain(CURRENT)
  })

  it.each([
    ['ru', 'Сменить имя пользователя', 'Сохранить имя', 'Имя пользователя изменено. Войдите с новым именем и текущим паролем.'],
    ['uz', 'Foydalanuvchi nomini oʻzgartirish', 'Nomni saqlash', 'Foydalanuvchi nomi oʻzgartirildi. Yangi nom va joriy parol bilan kiring.'],
  ] as const)('works in %s', async (lng, formName, button, notice) => {
    await i18n.changeLanguage(lng)
    mockApi()
    renderSettings()
    const f = within(await screen.findByRole('form', { name: formName }))
    expect(f.getByRole('button', { name: button })).toBeInTheDocument()
    await submit('hunter', CURRENT)
    expect(await screen.findByText(notice)).toBeInTheDocument()
  })
})
