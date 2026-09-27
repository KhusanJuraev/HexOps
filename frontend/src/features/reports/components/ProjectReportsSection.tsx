import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { Button } from '@/shared/ui/button'

import { DEFAULT_QUERY, useReports } from '../api'
import { ReportStatusBadge, SeverityBadge } from './Badges'

const SHOWN = 10

/** The "Reports" section of a project page: its latest reports, own loading/error state. */
export function ProjectReportsSection({ projectId }: { projectId: number }) {
  const { t } = useTranslation()
  const { data, isPending, isError, error, refetch } = useReports({ ...DEFAULT_QUERY, project_id: projectId }, SHOWN)

  const add = (
    <Button asChild variant="outline" size="sm" className="w-fit">
      <Link to={`/reports/new?project_id=${projectId}`}>
        <Plus aria-hidden="true" />
        {t('reports.projectSection.add')}
      </Link>
    </Button>
  )
  if (isPending) return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  if (isError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <p>{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  if (data.total === 0)
    return (
      <div className="grid gap-3">
        <p className="text-muted-foreground text-sm">{t('reports.projectSection.empty')}</p>
        {add}
      </div>
    )
  return (
    <div className="grid grid-cols-1 gap-3">
      <ul className="divide-y">
        {data.items.map((r) => (
          <li key={r.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2 first:pt-0">
            <Link to={`/reports/${r.id}`} className="min-w-0 flex-1 basis-48 text-sm font-medium break-words hover:underline">
              {r.title}
            </Link>
            <SeverityBadge severity={r.severity} />
            <ReportStatusBadge status={r.status} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {add}
        {data.total > SHOWN && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/reports?project_id=${projectId}`}>{t('reports.projectSection.viewAll', { count: data.total })}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
