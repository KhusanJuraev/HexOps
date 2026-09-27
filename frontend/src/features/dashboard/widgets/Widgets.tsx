import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { ActivityList } from '@/features/activity'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'

import { useBounties, useSeverity, useStatus, useSummary, useTimeline, type Range } from '../api'
import { count, money, monthLabel } from '../format'
import { BarChart } from './BarChart'
import { DataTable, Widget } from './Widget'

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
const STATUSES = ['draft', 'submitted', 'triaged', 'accepted', 'duplicate', 'rejected', 'paid']

export function SummaryTiles() {
  const { t } = useTranslation()
  const query = useSummary()
  return (
    <Widget id="w-summary" title={t('dashboard.overview')} query={query} isEmpty={() => false} emptyText="" className="md:col-span-2">
      {(s) => (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            [t('dashboard.activeProjects'), s.active_projects, '/projects?status=active', t('dashboard.ofProjects', { count: s.projects.active + s.projects.paused + s.projects.closed })],
            [t('dashboard.reports'), s.reports, '/reports', null],
            [t('dashboard.notes'), s.notes, '/notes', null],
          ].map(([label, value, to, sub]) => (
            <div key={String(to)} className="bg-muted/50 grid gap-1 rounded-lg p-3">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-2xl font-semibold">
                <Link to={String(to)} className="hover:underline">
                  {count(Number(value))}
                </Link>
              </dd>
              {sub && <dd className="text-muted-foreground text-xs">{sub}</dd>}
            </div>
          ))}
        </dl>
      )}
    </Widget>
  )
}

function CountsChart({ id, title, keys, prefix, query }: { id: string; title: string; keys: string[]; prefix: string; query: ReturnType<typeof useSeverity> }) {
  const { t } = useTranslation()
  return (
    <Widget id={id} title={title} query={query} isEmpty={(d) => d.total === 0} emptyText={t('dashboard.noReports')}>
      {(d) => {
        const data = keys.map((k) => ({ label: t(`${prefix}.${k}`), value: d.counts[k] ?? 0 }))
        const summary = t('dashboard.countsSummary', {
          title,
          total: count(d.total),
          parts: data.filter((x) => x.value > 0).map((x) => `${x.label} ${count(x.value)}`).join(', '),
        })
        return (
          <>
            <BarChart data={data} summary={summary} orientation="horizontal" height={keys.length * 30 + 24} />
            <DataTable caption={title} columns={[t('dashboard.category'), t('dashboard.count')]} rows={data.map((x) => [x.label, count(x.value)])} />
          </>
        )
      }}
    </Widget>
  )
}

export function SeverityWidget() {
  const { t } = useTranslation()
  return <CountsChart id="w-severity" title={t('dashboard.bySeverity')} keys={SEVERITIES} prefix="reports.severity" query={useSeverity()} />
}

export function StatusWidget() {
  const { t } = useTranslation()
  return <CountsChart id="w-status" title={t('dashboard.byStatus')} keys={STATUSES} prefix="reports.status" query={useStatus()} />
}

export function TimelineWidget({ range }: { range: Range }) {
  const { t } = useTranslation()
  const query = useTimeline(range)
  const title = t('dashboard.overTime')
  return (
    <Widget id="w-timeline" title={title} query={query} isEmpty={(d) => d.total === 0} emptyText={t('dashboard.noReportsInRange')} className="md:col-span-2">
      {(d) => {
        const data = d.months.map((m) => ({ label: monthLabel(m.month), value: m.count }))
        const peak = d.months.reduce((a, b) => (b.count > a.count ? b : a))
        const summary = t('dashboard.timelineSummary', {
          total: count(d.total),
          from: monthLabel(d.months[0].month),
          to: monthLabel(d.months.at(-1)!.month),
          peak: monthLabel(peak.month),
          peakCount: count(peak.count),
        })
        return (
          <>
            <p className="text-muted-foreground text-xs">{summary}</p>
            <BarChart data={data} summary={summary} />
            <DataTable caption={title} columns={[t('dashboard.month'), t('dashboard.count')]} rows={d.months.map((m) => [monthLabel(m.month), count(m.count)])} />
          </>
        )
      }}
    </Widget>
  )
}

export function BountiesWidget({ range }: { range: Range }) {
  const { t } = useTranslation()
  const query = useBounties(range)
  const title = t('dashboard.bounties')
  return (
    <Widget
      id="w-bounties"
      title={title}
      query={query}
      isEmpty={(d) => d.currencies.length === 0 && d.unpriced_paid === 0 && d.unpaid.length === 0}
      emptyText={t('dashboard.noBounties')}
      className="md:col-span-2"
    >
      {(d) => (
        <div className="grid grid-cols-1 gap-6">
          <p className="text-muted-foreground text-xs">{t('dashboard.currencyNote')}</p>
          {d.currencies.length === 0 && <p className="text-muted-foreground text-sm">{t('dashboard.noBounties')}</p>}
          {/* Small multiples: one chart per currency, never one total. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {d.currencies.map((c) => {
              const data = c.months.map((m) => ({ label: monthLabel(m.month), value: Number(m.amount), display: money(m.amount, c.currency) }))
              const summary = t('dashboard.bountySummary', { currency: c.currency, total: money(c.total, c.currency), count: c.count })
              return (
                <ErrorBoundary key={c.currency}>
                  <div className="grid min-w-0 grid-cols-1 gap-2" data-currency={c.currency}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-medium">{c.currency}</h3>
                      <p className="text-lg font-semibold">{money(c.total, c.currency)}</p>
                    </div>
                    <p className="text-muted-foreground text-xs">{t('dashboard.paidReports', { count: c.count })}</p>
                    <BarChart data={data} summary={summary} height={160} />
                    <DataTable
                      caption={`${title} (${c.currency})`}
                      columns={[t('dashboard.month'), c.currency]}
                      rows={c.months.map((m) => [monthLabel(m.month), money(m.amount, c.currency)])}
                    />
                  </div>
                </ErrorBoundary>
              )
            })}
          </div>
          {d.unpriced_paid > 0 && <p className="text-muted-foreground text-xs">{t('dashboard.unpriced', { count: d.unpriced_paid })}</p>}
          {d.unpaid.length > 0 && (
            <div className="grid min-w-0 gap-2 border-t pt-4" data-unpaid>
              <h3 className="text-sm font-medium">{t('dashboard.unpaidTitle')}</h3>
              <ul className="grid gap-1 text-sm">
                {d.unpaid.map((u) => (
                  <li key={u.currency} data-unpaid-currency={u.currency} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{money(u.total, u.currency)}</span>
                    <span className="text-muted-foreground text-xs">{t('dashboard.unpaidReports', { count: u.count })}</span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">{t('dashboard.unpaidHint')}</p>
            </div>
          )}
        </div>
      )}
    </Widget>
  )
}

export function ActivityWidget() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="w-activity" className="bg-card grid min-w-0 grid-cols-1 content-start gap-4 rounded-xl border p-4 md:p-5">
      <h2 id="w-activity" className="text-sm font-semibold">
        {t('dashboard.recentActivity')}
      </h2>
      <ErrorBoundary>
        <ActivityList scope={{ all: true }} showRecord pageSize={8} />
      </ErrorBoundary>
    </section>
  )
}
