import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileText } from 'lucide-react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { ToastProvider } from '@/shared/components/ToastProvider'
import en from '@/shared/i18n/locales/en.json'
import i18n from '@/shared/i18n'
import { ThemeProvider } from '@/shared/theme/ThemeProvider'

import { navItems, PAGES, type PageEntry } from './modules'
import { createQueryClient } from './queryClient'
import { buildRoutes } from './routes'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const SESSION = { user: { id: 1, username: 'researcher', last_login_at: null }, expires_at: '' }

function Boom(): never {
  throw new Error('render failure')
}

const TEST_PAGES: PageEntry[] = [
  { path: '/', page: async () => ({ default: () => <h1>home page</h1> }), nav: { labelKey: 'nav.dashboard', icon: FileText, section: 'primary' } },
  { path: '/broken', page: async () => ({ default: Boom }), nav: { labelKey: 'nav.reports', icon: FileText, section: 'primary' } },
  { path: '/unloadable', page: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module')) },
]

function renderAt(path: string) {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === '/api/auth/me' ? json(200, SESSION) : json(200, { status: 'ok' }),
  )
  const router = createMemoryRouter(buildRoutes(TEST_PAGES), { initialEntries: [path] })
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

describe('page registry', () => {
  it('every sidebar label exists in the locale files', () => {
    const lookup = (key: string) => key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en)
    for (const page of PAGES) if (page.nav) expect(lookup(page.nav.labelKey), page.nav.labelKey).toBeTypeOf('string')
  })

  it('paths are unique and absolute', () => {
    const paths = PAGES.map((p) => p.path)
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((p) => p.startsWith('/'))).toBe(true)
  })

  it('builds the sidebar from the registry', () => {
    expect(navItems('primary').map((n) => n.to)).toEqual(['/', '/search', '/reports', '/projects', '/notes'])
    expect(navItems('secondary').map((n) => n.to)).toEqual(['/settings'])
  })
})

describe('error isolation', () => {
  beforeEach(() => void i18n.changeLanguage('en'))

  it('a page that throws is contained; the shell and navigation keep working', async () => {
    renderAt('/broken')
    expect(await screen.findByText('This page could not be displayed')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Signed in as' })).toBeInTheDocument()
  })

  it('navigating away from a failed page clears the error', async () => {
    renderAt('/broken')
    await screen.findByText('This page could not be displayed')
    await userEvent.click(screen.getByRole('link', { name: 'Dashboard' }))
    expect(await screen.findByRole('heading', { name: 'home page' })).toBeInTheDocument()
    expect(screen.queryByText('This page could not be displayed')).not.toBeInTheDocument()
  })

  it('a page chunk that fails to load is contained as well', async () => {
    renderAt('/unloadable')
    expect(await screen.findByText('This page could not be displayed')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
  })

  it('ErrorBoundary contains a failing widget and can retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let fail = true
    function Widget() {
      if (fail) throw new Error('widget failure')
      return <p>widget ok</p>
    }
    render(
      <>
        <ErrorBoundary>
          <Widget />
        </ErrorBoundary>
        <p>other widget</p>
      </>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('This section could not be displayed.')
    expect(screen.getByText('other widget')).toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('widget ok')).toBeInTheDocument()
  })
})

describe('collapsible desktop sidebar', () => {
  beforeEach(() => {
    localStorage.clear()
    void i18n.changeLanguage('en')
  })

  const sidebar = () => document.getElementById('app-sidebar')!

  it('toggles between full and icon rail, keeps names and tooltips, and remembers the choice', async () => {
    renderAt('/')
    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar')
    expect(toggle.querySelector('svg')).toHaveClass('lucide-panel-left-close')
    expect(sidebar()).toHaveAttribute('data-collapsed', 'false')

    await userEvent.click(toggle)
    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(expand.querySelector('svg')).toHaveClass('lucide-panel-left-open')
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
    expect(sidebar()).not.toHaveClass('lg:w-60')
    expect(localStorage.getItem('hexops.sidebar')).toBe('collapsed')

    // Icons only, but every link keeps its accessible name and a visible tooltip.
    const link = screen.getByRole('link', { name: 'Dashboard' })
    expect(link).toHaveAttribute('aria-current', 'page')
    const tip = link.querySelector('[data-nav-tooltip]')!
    expect(tip).toHaveTextContent('Dashboard')
    expect(tip).toHaveAttribute('aria-hidden', 'true')
    expect(tip).not.toHaveClass('lg:hidden') // shown on desktop too while collapsed
  })

  it('starts collapsed after a reload', async () => {
    localStorage.setItem('hexops.sidebar', 'collapsed')
    renderAt('/')
    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(sidebar()).toHaveAttribute('data-collapsed', 'true')
  })

  it('works from the keyboard', async () => {
    renderAt('/')
    const toggle = await screen.findByRole('button', { name: 'Collapse sidebar' })
    toggle.focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveFocus()
    await userEvent.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toHaveFocus()
    expect(localStorage.getItem('hexops.sidebar')).toBe('expanded')
  })

  it.each([
    ['ru', 'Свернуть боковую панель', 'Развернуть боковую панель'],
    ['uz', 'Yon panelni yigʻish', 'Yon panelni yoyish'],
  ])('is labelled in %s', async (lng, collapse, expand) => {
    await i18n.changeLanguage(lng)
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: collapse }))
    expect(screen.getByRole('button', { name: expand })).toBeInTheDocument()
  })

  it('works when browser storage is unavailable', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderAt('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }))
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    get.mockRestore()
    set.mockRestore()
  })
})
