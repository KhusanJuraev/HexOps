import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'

import { useImportDraft, type ImportDraft } from '@/features/pdf'
import { ApiError } from '@/shared/api/client'
import { apiErrorMessage } from '@/shared/api/errors'
import { useToast } from '@/shared/components/toast'
import { useUnsavedChanges } from '@/shared/components/UnsavedChanges'
import { FullPageStatus } from '@/shared/layout/FullPageStatus'
import { PageHeader } from '@/shared/layout/PageHeader'

import { useNote, useSaveNote } from './api'
import { NoteForm } from './components/NoteForm'
import { NoteNotFound } from './components/NoteNotFound'
import { parseId } from './params'
import type { Note } from './types'

function Editor({ note, projectId, draft }: { note?: Note; projectId?: number | null; draft?: ImportDraft }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const toast = useToast()
  const save = useSaveNote(note?.id ?? null)
  const [dirty, setDirty] = useState(false)
  const guard = useUnsavedChanges(dirty)
  return (
    <>
      {guard.dialog}
      <PageHeader title={note ? t('notes.edit') : t('notes.new')} description={note?.title ?? (draft ? t('pdf.import.fromDraft') : undefined)} />
      <NoteForm
        initial={note}
        initialProjectId={projectId}
        draft={draft}
        submitLabel={note ? t('notes.form.save') : t('notes.form.create')}
        pending={save.isPending}
        error={save.error}
        onDirtyChange={setDirty}
        onCancel={() => navigate(note ? `/notes/${note.id}` : '/notes')}
        onSubmit={(input) =>
          save.mutate(input, {
            onSuccess: (saved) => {
              guard.release()
              toast({ tone: 'success', message: t(note ? 'notes.toast.saved' : 'notes.toast.created') })
              navigate(`/notes/${saved.id}`, { replace: !note })
            },
          })
        }
      />
    </>
  )
}

/** /notes/new, optionally ?project_id= from a project page. */
export function NoteNewPage() {
  const [params] = useSearchParams()
  const draft = useImportDraft()
  return <Editor projectId={parseId(params.get('project_id'))} draft={draft} />
}

/** /notes/:noteId/edit — the form mounts once the note is loaded. */
export function NoteEditPage() {
  const { t } = useTranslation()
  const id = parseId(useParams().noteId)
  const { data, isPending, error } = useNote(id)
  if (id === null || (error instanceof ApiError && error.status === 404)) return <NoteNotFound />
  if (isPending) return <FullPageStatus kind="loading" />
  if (error) return <p role="alert" className="text-danger text-sm">{apiErrorMessage(t, error)}</p>
  return <Editor key={data.updated_at} note={data} />
}
