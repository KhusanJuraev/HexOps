import { FileUp, NotebookPen, Plus, SearchX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { Pagination } from '@/shared/components/Pagination'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { DEFAULT_QUERY, PAGE_SIZE, toSearchParams, useNotes } from './api'
import { NoteFilters } from './components/NoteFilters'
import { TagList } from './components/TagList'
import { parseQuery } from './params'
import type { NoteQuery } from './types'

export default function NotesPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const query = parseQuery(params)
  const { data, isPending, isError, error, refetch, isPlaceholderData } = useNotes(query)
  const filtered = Boolean(query.q || query.tag.length || query.project_id)

  const update = (patch: Partial<NoteQuery>) =>
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
        icon={NotebookPen}
        title={t('notes.empty.title')}
        description={t('notes.empty.body')}
        action={
          <Button asChild>
            <Link to="/notes/new">{t('notes.new')}</Link>
          </Button>
        }
      />
    )
  else if (data.items.length === 0)
    body = (
      <EmptyState
        icon={SearchX}
        title={t('notes.empty.filteredTitle')}
        description={t('notes.empty.filteredBody')}
        action={
          <Button variant="outline" onClick={clear}>
            {t('notes.clearFilters')}
          </Button>
        }
      />
    )
  else
    body = (
      <div className={isPlaceholderData ? 'grid grid-cols-1 gap-4 opacity-60' : 'grid grid-cols-1 gap-4'} aria-busy={isPlaceholderData}>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.items.map((n) => (
            <li key={n.id} className="bg-card grid min-w-0 grid-cols-1 content-start gap-2 rounded-xl border p-4">
              <Link to={`/notes/${n.id}`} className="font-medium break-words hover:underline focus-visible:underline">
                {n.title}
              </Link>
              <p className="text-muted-foreground text-xs break-words">
                {[n.project_name, t('notes.updated', { date: formatDateTime(n.updated_at) })].filter(Boolean).join(' · ')}
              </p>
              <TagList tags={n.tags} />
            </li>
          ))}
        </ul>
        <Pagination page={query.page} size={PAGE_SIZE} total={data.total} onPage={(page) => update({ page })} />
      </div>
    )

  return (
    <>
      <PageHeader
        title={t('nav.notes')}
        description={t('modules.notes')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/import">
                <FileUp aria-hidden="true" />
                {t('pdf.import.open')}
              </Link>
            </Button>
            <Button asChild>
              <Link to="/notes/new">
                <Plus aria-hidden="true" />
                {t('notes.new')}
              </Link>
            </Button>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6">
        <NoteFilters query={query} onChange={update} onClear={clear} filtered={filtered} />
        {body}
      </div>
    </>
  )
}
