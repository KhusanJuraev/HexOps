import { FileText, FileUp, Plus, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { Pagination } from '@/shared/components/Pagination'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { DEFAULT_QUERY, PAGE_SIZE, toSearchParams, useReports } from './api'
import { ReportStatusBadge, ReportTypeBadge, SeverityBadge } from './components/Badges'
import { ReportFilters } from './components/ReportFilters'
import { parseQuery } from './params'
import type { ReportListItem, ReportQuery } from './types'

function ReportTable({ items }: { items: ReportListItem[] }) {
  const { t } = useTranslation()
  const th = 'px-4 py-3 font-medium'
  return (
    <div className="bg-card hidden overflow-x-auto rounded-xl border md:block">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b text-left text-xs">
          <tr>
            <th scope="col" className={th}>{t('reports.columns.title')}</th>
            <th scope="col" className={th}>{t('reports.columns.severity')}</th>
            <th scope="col" className={th}>{t('reports.columns.status')}</th>
            <th scope="col" className={`${th} hidden lg:table-cell`}>{t('reports.columns.type')}</th>
            <th scope="col" className={`${th} hidden xl:table-cell`}>{t('reports.columns.submitted')}</th>
            <th scope="col" className={th}>{t('reports.columns.updated')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className="border-b align-top last:border-0">
              <td className="max-w-80 px-4 py-3">
                <Link to={`/reports/${r.id}`} className="font-medium break-words hover:underline focus-visible:underline">
                  {r.title}
                </Link>
                <span className="text-muted-foreground block text-xs break-words">{r.project_name}</span>
              </td>
              <td className="px-4 py-3">
                <SeverityBadge severity={r.severity} />
                {r.cvss_score && <span className="text-muted-foreground mt-1 block text-xs">CVSS {r.cvss_score}</span>}
              </td>
              <td className="px-4 py-3"><ReportStatusBadge status={r.status} /></td>
              <td className="hidden px-4 py-3 lg:table-cell"><ReportTypeBadge type={r.type} /></td>
              <td className="hidden px-4 py-3 whitespace-nowrap xl:table-cell">{r.submitted_at ? formatDate(r.submitted_at.slice(0, 10)) : '—'}</td>
              <td className="text-muted-foreground px-4 py-3 whitespace-nowrap">{formatDateTime(r.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportCards({ items }: { items: ReportListItem[] }) {
  return (
    <ul className="grid grid-cols-1 gap-3 md:hidden">
      {items.map((r) => (
        <li key={r.id}>
          <Link to={`/reports/${r.id}`} className="bg-card focus-visible:ring-ring/50 block rounded-xl border p-4 outline-none focus-visible:ring-[3px]">
            <span className="block font-medium break-words">{r.title}</span>
            <span className="text-muted-foreground block text-xs break-words">{r.project_name}</span>
            <span className="mt-2 flex flex-wrap gap-2">
              <SeverityBadge severity={r.severity} />
              <ReportStatusBadge status={r.status} />
              <ReportTypeBadge type={r.type} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function ReportsPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useReports(query)
  const filtered = Boolean(query.q || query.project_id || query.type || query.severity || query.status || query.created_from || query.created_to)

  const update = (patch: Partial<ReportQuery>) =>
    setParams((prev) => toSearchParams({ ...parseQuery(prev), page: 1, ...patch }), { replace: 'q' in patch })
  const clear = () => setParams(toSearchParams({ ...DEFAULT_QUERY, sort: query.sort, order: query.order }))

  let body: React.ReactNode
  if (isPending) body = <FullPageStatus kind="loading" />
  else if (isError)
    body = (
      <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex-1">{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  else if (data.total === 0 && !filtered)
    body = (
      <EmptyState
        icon={FileText}
        title={t('reports.empty.title')}
        description={t('reports.empty.body')}
        action={
          <Button asChild>
            <Link to="/reports/new">{t('reports.new')}</Link>
          </Button>
        }
      />
    )
  else if (data.items.length === 0)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('reports.empty.filteredTitle')}
        description={t('reports.empty.filteredBody')}
        action={
          <Button variant="outline" onClick={clear}>
            {t('reports.clearFilters')}
          </Button>
        }
      />
    )
  else
    body = (
      <div className={isPlaceholderData ? 'grid grid-cols-1 gap-4 opacity-60' : 'grid grid-cols-1 gap-4'} aria-busy={isPlaceholderData}>
        <ReportTable items={data.items} />
        <ReportCards items={data.items} />
        <Pagination page={query.page} size={PAGE_SIZE} total={data.total} onPage={(page) => update({ page })} />
      </div>
    )

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        description={t('modules.reports')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/import">
                <FileUp aria-hidden="true" />
                {t('pdf.import.open')}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/reports/new">
                <Plus aria-hidden="true" />
                {t('reports.new')}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6">
        <ReportFilters query={query} onChange={update} onClear={clear} filtered={filtered} />
        {body}
      </div>
    </>
  )
}
