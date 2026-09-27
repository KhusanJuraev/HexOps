import { Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'

import { ActivityList } from '@/features/activity'
import { ExportPdfButton } from '@/features/pdf'
import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { ConfirmButton } from '@/shared/components/ConfirmButton'
import { MarkdownView } from '@/shared/components/markdown'
import { Section } from '@/shared/components/Section'
import { useToast } from '@/shared/components/toast'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/button'

import { useDeleteNote, useNote } from './api'
import { NoteNotFound } from './components/NoteNotFound'
import { TagList } from './components/TagList'
import { parseId } from './params'

export default function NoteDetailPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const id = parseId(useParams().noteId)
  const { data: note, isPending, isError, error, refetch } = useNote(id)
  const remove = useDeleteNote(id ?? 0)

  if (id === null || (error instanceof ApiError && error.status === 404)) return <NoteNotFound />
  if (isPending) return <FullPageStatus kind="loading" />
  if (isError)
    return (
      <div role="alert" className="bg-card flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm">
        <p className="flex-1">{apiErrorMessage(t, error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )

  return (
    <>
      <PageHeader
        title={note.title}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to={`/notes/${note.id}/edit`}>
                <Pencil aria-hidden="true" />
                {t('common.edit')}
              </Link>
            </Button>
            <ExportPdfButton sourceType="note" sourceId={note.id} />
            <ConfirmButton
              title={t('notes.deleteDialog.title')}
              body={t('notes.deleteDialog.body', { name: note.title })}
              confirmLabel={t('notes.deleteDialog.confirm')}
              pending={remove.isPending}
              onConfirm={() =>
                remove.mutate(undefined, {
                  onSuccess: () => {
                    toast({ tone: 'success', message: t('notes.toast.deleted') })
                    navigate('/notes', { replace: true })
                  },
                  onError: (err) => toast({ tone: 'error', message: apiErrorMessage(t, err) }),
                })
              }
            >
              <Trash2 aria-hidden="true" />
              {t('common.delete')}
            </ConfirmButton>
          </div>
        }
      />
      <div className="-mt-4 mb-8 grid min-w-0 grid-cols-1 gap-2">
        <p className="text-muted-foreground text-sm break-words">
          {note.project_id !== null && (
            <>
              <Link to={`/projects/${note.project_id}`} className="hover:underline">
                {note.project_name}
              </Link>
              {' · '}
            </>
          )}
          {t('notes.updated', { date: formatDateTime(note.updated_at) })}
        </p>
        <TagList tags={note.tags} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Section id="section-body" title={t('notes.detail.body')}>
          {note.body_md.trim() ? <MarkdownView source={note.body_md} /> : <p className="text-muted-foreground text-sm">{t('notes.detail.noBody')}</p>}
        </Section>
        <div className="min-w-0">
          <Section id="section-activity" title={t('notes.detail.activity')}>
            <ActivityList scope={{ entityType: 'note', entityId: note.id }} />
          </Section>
        </div>
      </div>
    </>
  )
}
