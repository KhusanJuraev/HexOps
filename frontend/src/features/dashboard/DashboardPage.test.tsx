import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/shared/i18n'

import { lastMonths } from './api'
import DashboardPage from './DashboardPage'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const zeros = (keys: string[]) => ({ counts: Object.fromEntries(keys.map((k) => [k, 0])), total: 0 })
const SEV = ['critical', 'high', 'medium', 'low', 'info']
const STA = ['draft', 'submitted', 'triaged', 'accepted', 'duplicate', 'rejected', 'paid']

const EMPTY: Record<string, unknown> = {
  summary: { projects: { active: 0, paused: 0, closed: 0 }, active_projects: 0, reports: 0, notes: 0 },
  severity: zeros(SEV),
  status: zeros(STA),
  timeline: { months: [{ month: '2026-08', count: 0 }, { month: '2026-09', count: 0 }], total: 0 },
  bounties: { currencies: [], unpriced_paid: 0, unpaid: [] },
}
const FULL: Record<string, unknown> = {
  summary: { projects: { active: 2, paused: 1, closed: 1 }, active_projects: 2, reports: 9, notes: 3 },
  severity: { counts: { critical: 2, high: 3, medium: 1, low: 2, info: 1 }, total: 9 },
  status: { counts: { draft: 1, submitted: 1, triaged: 1, accepted: 0, duplicate: 0, rejected: 1, paid: 5 }, total: 9 },
  timeline: { months: [{ month: '2026-08', count: 3 }, { month: '2026-09', count: 5 }], total: 8 },
  bounties: {
    currencies: [
      { currency: 'EUR', total: '50.00', count: 1, months: [{ month: '2026-08', amount: '50.00', count: 1 }, { month: '2026-09', amount: '0.00', count: 0 }] },
      { currency: 'USD', total: '300.75', count: 2, months: [{ month: '2026-08', amount: '100.50', count: 1 }, { month: '2026-09', amount: '200.25', count: 1 }] },
    ],
    unpriced_paid: 1,
    unpaid: [],
  },
}

function mockApi(data: Record<string, unknown>, failing: string[] = []) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://x')
    if (url.pathname === '/api/auth/me') return json(200, { user: { id: 1, username: 'researcher', last_login_at: null }, expires_at: '' })
    if (url.pathname === '/api/activity') return json(200, { items: [], total: 0, page: 1, size: 8 })
    const name = url.pathname.replace('/api/dashboard/', '')
    if (failing.includes(name)) return json(500, { detail: 'x', code: 'internal_error' })
    if (name in data) return json(200, data[name])
    throw new Error(`unexpected ${url.pathname}`)
  })
}

function renderPage() {
  const router = createMemoryRouter([{ path: '/', element: <DashboardPage /> }], { initialEntries: ['/'] })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}
const region = (name: string) => screen.findByRole('region', { name })

describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    void i18n.changeLanguage('en')
  })

  it('an empty database shows empty states, not invented numbers', async () => {
    mockApi(EMPTY)
    renderPage()
    expect(await within(await region('Findings by severity')).findByText('No reports yet.')).toBeInTheDocument()
    expect(await within(await region('Reports by status')).findByText('No reports yet.')).toBeInTheDocument()
    expect(await within(await region('Findings over time')).findByText('No reports were created in this period.')).toBeInTheDocument()
    expect(await within(await region('Bounty earnings')).findByText('No paid bounties in this period.')).toBeInTheDocument()
    expect(await within(await region('Recent activity')).findByText('No activity yet.')).toBeInTheDocument()
    const overview = await region('Overview')
    expect(await within(overview).findAllByText('0')).toHaveLength(3)
  })

  it('shows every number with a text equivalent', async () => {
    mockApi(FULL)
    renderPage()
    const sev = await region('Findings by severity')
    expect(await within(sev).findByRole('img', { name: /Findings by severity: 9 in total\. Critical 2, High 3, Medium 1, Low 2, Info 1\./ })).toBeInTheDocument()
    const rows = within(sev).getAllByRole('row').map((r) => r.textContent)
    expect(rows).toEqual(['CategoryCount', 'Critical2', 'High3', 'Medium1', 'Low2', 'Info1'])
    const time = await region('Findings over time')
    expect(within(time).getByText(/8 reports created from 08\/2026 to 09\/2026; the busiest month was 09\/2026 with 5\./)).toBeInTheDocument()
    const overview = await region('Overview')
    expect(within(overview).getByText('of 4 projects')).toBeInTheDocument()
  })

  it('keeps currencies apart and never adds them up', async () => {
    mockApi(FULL)
    renderPage()
    const bounties = await region('Bounty earnings')
    const cards = await within(bounties).findAllByRole('heading', { level: 3 })
    expect(cards.map((h) => h.textContent)).toEqual(['EUR', 'USD'])
    const total = (currency: string) => bounties.querySelector(`[data-currency="${currency}"] p.text-lg`)?.textContent
    expect(total('EUR')).toBe('€50.00')
    expect(total('USD')).toBe('$300.75')
    expect(within(bounties).queryByText(/350\.75/)).not.toBeInTheDocument()
    expect(within(bounties).getByText('Paid reports without a recorded amount: 1 (not included above).')).toBeInTheDocument()
    expect(within(bounties).getByText('Each currency is shown on its own; amounts in different currencies are never added together.')).toBeInTheDocument()
  })

  it('amounts on reports not marked Paid are shown apart, never as earnings', async () => {
    // The reported case: a BBP draft with 100000 UZS and a submitted one with 100 USD.
    mockApi({
      ...FULL,
      bounties: {
        currencies: [],
        unpriced_paid: 0,
        unpaid: [
          { currency: 'USD', total: '100.00', count: 1 },
          { currency: 'UZS', total: '100000.00', count: 1 },
        ],
      },
    })
    renderPage()
    const bounties = await region('Bounty earnings')
    expect(await within(bounties).findByText('No paid bounties in this period.')).toBeInTheDocument()
    expect(within(bounties).queryAllByRole('img')).toHaveLength(0) // no earnings chart
    expect(within(bounties).getByRole('heading', { level: 3, name: 'Recorded, not marked Paid' })).toBeInTheDocument()
    const row = (c: string) => bounties.querySelector(`[data-unpaid-currency="${c}"]`)?.textContent
    expect(row('USD')).toBe('$100.00Reports: 1')
    expect(row('UZS')).toMatch(/^UZS\s?100,000\.00Reports: 1$/)
    expect(within(bounties).getByText(/They are not earnings: mark a report as Paid/)).toBeInTheDocument()
  })

  it('paid earnings and unpaid amounts appear together without mixing', async () => {
    const full = FULL.bounties as Record<string, unknown>
    mockApi({ ...FULL, bounties: { ...full, unpaid: [{ currency: 'USD', total: '40.00', count: 1 }] } })
    renderPage()
    const bounties = await region('Bounty earnings')
    await within(bounties).findByText('Recorded, not marked Paid')
    expect(bounties.querySelector('[data-currency="USD"] p.text-lg')?.textContent).toBe('$300.75') // unchanged
    expect(bounties.querySelector('[data-unpaid-currency="USD"]')?.textContent).toContain('$40.00')
    expect(within(bounties).queryByText(/340\.75/)).not.toBeInTheDocument()
  })

  it('a widget that cannot read its data fails alone', async () => {
    // e.g. an API older than the UI: bounties without the `unpaid` field.
    mockApi({ ...FULL, bounties: { currencies: [], unpriced_paid: 0 } })
    renderPage()
    const severity = await region('Findings by severity')
    expect(await within(severity).findByRole('img')).toHaveAttribute('aria-label', expect.stringContaining('9 in total'))
    expect(await within(await region('Bounty earnings')).findByRole('alert')).toBeInTheDocument()
    expect(within(await region('Reports by status')).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(await region('Findings by severity')).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('one failing widget does not blank the others', async () => {
    mockApi(FULL, ['severity', 'bounties'])
    renderPage()
    const sev = await region('Findings by severity')
    expect(await within(sev).findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(await within(await region('Bounty earnings')).findByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(await within(await region('Reports by status')).findByRole('img')).toBeInTheDocument()
    expect(await within(await region('Findings over time')).findByRole('img')).toBeInTheDocument()
  })

  it('changing the period refetches only the dated widgets with the new range', async () => {
    const spy = mockApi(FULL)
    renderPage()
    await region('Findings over time')
    await userEvent.selectOptions(screen.getByLabelText('Period'), '3')
    const r = lastMonths(3)
    await vi.waitFor(() => {
      const urls = spy.mock.calls.map(([u]) => String(u))
      expect(urls).toContain(`/api/dashboard/timeline?start=${r.start}&end=${r.end}`)
      expect(urls).toContain(`/api/dashboard/bounties?start=${r.start}&end=${r.end}`)
    })
    expect(localStorage.getItem('hexops.dashboardMonths')).toBe('3')
  })

  it('computes month ranges in UTC', () => {
    expect(lastMonths(12, new Date(Date.UTC(2026, 0, 31, 23, 0)))).toEqual({ start: '2025-02', end: '2026-01' })
    expect(lastMonths(3, new Date(Date.UTC(2026, 2, 1)))).toEqual({ start: '2026-01', end: '2026-03' })
  })

  it('renders in Russian', async () => {
    await i18n.changeLanguage('ru')
    mockApi(FULL)
    renderPage()
    expect(await region('Находки по критичности')).toBeInTheDocument()
    expect(await region('Доход от вознаграждений')).toBeInTheDocument()
  })
})
