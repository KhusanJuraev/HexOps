import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { Pagination } from '@/shared/components/Pagination'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { ACTIVITY_PAGE_SIZE, useActivity } from './api'
import { describe } from './describe'
import type { ActivityScope } from './types'

interface Props {
  scope: ActivityScope
  /** On a project page, say which report an event belongs to. */
  showRecord?: boolean
  /** Items per page; the Dashboard shows a short list. */
  pageSize?: number
}

/** Own query and own loading/error state: a failure stays inside this section. */
export function ActivityList({ scope, showRecord = false, pageSize }: Props) {
  const { t } = useTranslation()
  const [page, setPage] = useState(1)
  const { data, isPending, isError, error, refetch } = useActivity(scope, page, pageSize)

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
  if (data.total === 0) return <p className="text-muted-foreground text-sm">{t('activity.empty')}</p>
  return (
    <div className="grid grid-cols-1 gap-4">
      <ol className="grid grid-cols-1 gap-3">
        {data.items.map((e) => (
          <li key={e.id} className="grid min-w-0 grid-cols-1 gap-0.5 border-l-2 pl-3 text-sm">
            {showRecord && (e.entity_type === 'report' || e.entity_type === 'note') && (
              <Link to={`/${e.entity_type}s/${e.entity_id}`} className="text-muted-foreground text-xs hover:underline">
                {t(e.entity_type === 'report' ? 'activity.reportRef' : 'activity.noteRef', { id: e.entity_id })}
              </Link>
            )}
            <span className="break-words">{describe(t, e)}</span>
            <span className="text-muted-foreground text-xs">
              <time dateTime={e.occurred_at}>{formatDateTime(e.occurred_at)}</time>
              {e.actor && ` · ${t('activity.by', { actor: e.actor })}`}
            </span>
          </li>
        ))}
      </ol>
      <Pagination page={page} size={pageSize ?? ACTIVITY_PAGE_SIZE} total={data.total} onPage={setPage} />
    </div>
  )
}
