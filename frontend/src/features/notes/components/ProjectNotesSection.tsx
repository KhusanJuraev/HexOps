import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { apiErrorMessage } from '@/shared/api/errors'
import { Button } from '@/shared/ui/button'

import { DEFAULT_QUERY, useNotes } from '../api'
import { TagList } from './TagList'

const SHOWN = 10

/** The "Notes" section of a project page, with its own loading and error state. */
export function ProjectNotesSection({ projectId }: { projectId: number }) {
  const { t } = useTranslation()
  const { data, isPending, isError, error, refetch } = useNotes({ ...DEFAULT_QUERY, project_id: projectId }, SHOWN)
  const add = (
    <Button asChild variant="outline" size="sm" className="w-fit">
      <Link to={`/notes/new?project_id=${projectId}`}>
        <Plus aria-hidden="true" />
        {t('notes.projectSection.add')}
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
        <p className="text-muted-foreground text-sm">{t('notes.projectSection.empty')}</p>
        {add}
      </div>
    )
  return (
    <div className="grid grid-cols-1 gap-3">
      <ul className="divide-y">
        {data.items.map((n) => (
          <li key={n.id} className="grid min-w-0 grid-cols-1 gap-1.5 py-2 first:pt-0">
            <Link to={`/notes/${n.id}`} className="text-sm font-medium break-words hover:underline">
              {n.title}
            </Link>
            <TagList tags={n.tags} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {add}
        {data.total > SHOWN && (
          <Button asChild variant="ghost" size="sm">
            <Link to={`/notes?project_id=${projectId}`}>{t('notes.projectSection.viewAll', { count: data.total })}</Link>
          </Button>
        )}
      </div>
    </div>
  )
}
