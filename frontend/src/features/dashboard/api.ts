import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { api } from '@/shared/api/client'

// Mirrors backend/app/modules/dashboard/schemas.py. One query per widget, so each
// loads and fails on its own.

export interface Counts {
  counts: Record<string, number>
  total: number
}
export interface Summary {
  projects: Record<string, number>
  active_projects: number
  reports: number
  notes: number
}
export interface Timeline {
  months: { month: string; count: number }[]
  total: number
}
export interface CurrencySeries {
  currency: string
  total: string
  count: number
  months: { month: string; amount: string; count: number }[]
}
export interface CurrencyTotal {
  currency: string
  total: string
  count: number
}

export interface Bounties {
  currencies: CurrencySeries[]
  unpriced_paid: number
  /** Amounts on BBP reports not marked Paid (any date): shown apart, never earnings. */
  unpaid: CurrencyTotal[]
}

export interface Range {
  start: string // YYYY-MM
  end: string
}

const get = <T,>(path: string) => ({ signal }: { signal: AbortSignal }) => api<T>(path, { signal })
const qs = (r: Range) => `?start=${r.start}&end=${r.end}`

export const useSummary = () => useQuery({ queryKey: ['dashboard', 'summary'], queryFn: get<Summary>('/api/dashboard/summary') })
export const useSeverity = () => useQuery({ queryKey: ['dashboard', 'severity'], queryFn: get<Counts>('/api/dashboard/severity') })
export const useStatus = () => useQuery({ queryKey: ['dashboard', 'status'], queryFn: get<Counts>('/api/dashboard/status') })
export const useTimeline = (r: Range) =>
  useQuery({ queryKey: ['dashboard', 'timeline', r], queryFn: get<Timeline>(`/api/dashboard/timeline${qs(r)}`), placeholderData: keepPreviousData })
export const useBounties = (r: Range) =>
  useQuery({ queryKey: ['dashboard', 'bounties', r], queryFn: get<Bounties>(`/api/dashboard/bounties${qs(r)}`), placeholderData: keepPreviousData })

/** The last `months` calendar months up to this one, as YYYY-MM (UTC, like the server). */
export function lastMonths(months: number, now = new Date()): Range {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - (months - 1), 1))
  const fmt = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  return { start: fmt(start), end: fmt(end) }
}
