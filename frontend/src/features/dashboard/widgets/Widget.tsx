import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { apiErrorMessage } from '@/shared/api/errors'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { Button } from '@/shared/ui/button'

interface Props<T> {
  id: string
  title: string
  query: UseQueryResult<T>
  /** True when the data has nothing to show: an empty state, never invented numbers. */
  isEmpty: (data: T) => boolean
  emptyText: string
  children: (data: T) => ReactNode
  className?: string
}

/**
 * One dashboard card. Its own query, its own loading / empty / error state and its
 * own ErrorBoundary: one failing widget never blanks the others (D-77).
 */
export function Widget<T>({ id, title, className, ...body }: Props<T>) {
  return (
    <section aria-labelledby={id} className={`bg-card grid min-w-0 grid-cols-1 content-start gap-4 rounded-xl border p-4 md:p-5 ${className ?? ''}`}>
      <h2 id={id} className="text-sm font-semibold">
        {title}
      </h2>
      {/* isEmpty and children run inside the boundary: data this widget cannot read
          (e.g. from an older API) fails this card only, never the whole dashboard. */}
      <ErrorBoundary>
        <WidgetBody {...body} />
      </ErrorBoundary>
    </section>
  )
}

function WidgetBody<T>({ query, isEmpty, emptyText, children }: Omit<Props<T>, 'id' | 'title' | 'className'>) {
  const { t } = useTranslation()
  if (query.isPending) return <p className="text-muted-foreground text-sm">{t('common.loading')}</p>
  if (query.isError)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm">
        <p>{apiErrorMessage(t, query.error)}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  if (isEmpty(query.data)) return <p className="text-muted-foreground text-sm">{emptyText}</p>
  return <>{children(query.data)}</>
}

/** The accessible text equivalent of a chart: a real table, opened on demand. */
export function DataTable({ caption, columns, rows }: { caption: string; columns: string[]; rows: (string | number)[][] }) {
  const { t } = useTranslation()
  return (
    <details className="text-sm">
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 w-fit cursor-pointer rounded text-xs outline-none focus-visible:ring-[3px]">
        {t('dashboard.showData')}
      </summary>
      <div className="mt-2 max-w-full overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-muted">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={`px-3 py-1.5 font-medium ${i > 0 ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r[0])} className="border-t">
                {r.map((cell, i) => (
                  <td key={i} className={`px-3 py-1.5 ${i > 0 ? 'text-right tabular-nums' : ''}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
