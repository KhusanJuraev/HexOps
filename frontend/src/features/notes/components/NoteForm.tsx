import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { FieldError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { MarkdownEditor } from '@/shared/components/markdown'
import { SearchSelect } from '@/shared/components/SearchSelect'
import { Button } from '@/shared/ui/button'

import { useProjectOptions } from '../api'
import { MAX_BODY_CHARS, type Note, type NoteInput } from '../types'
import { TagInput } from './TagInput'

interface Props {
  initial?: Note
  initialProjectId?: number | null
  /** A new note prefilled from an imported PDF draft (Stage 7); it counts as unsaved. */
  draft?: { title: string; body_md: string }
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (input: NoteInput) => void
  onCancel: () => void
  onDirtyChange?: (dirty: boolean) => void
}

export function NoteForm({ initial, initialProjectId, draft, submitLabel, pending, error, onSubmit, onCancel, onDirtyChange }: Props) {
  const { t } = useTranslation()
  const [title, setTitle] = useState(initial?.title ?? draft?.title ?? '')
  const [projectId, setProjectId] = useState<number | null>(initial?.project_id ?? initialProjectId ?? null)
  const [tags, setTags] = useState<string[]>(initial?.tags ?? [])
  const [body, setBody] = useState(initial?.body_md ?? draft?.body_md ?? '')
  const [search, setSearch] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, FieldError>>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const { data: projects } = useProjectOptions(search)

  const snapshot = JSON.stringify([title, projectId, tags, body])
  // An imported draft is compared with an empty form, so leaving it unsaved asks first.
  const [initialSnapshot] = useState(() => (draft ? JSON.stringify(['', projectId, tags, '']) : snapshot))
  const dirty = snapshot !== initialSnapshot
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const serverErrors = fieldErrorsOf(error)
  const all = { ...serverErrors, ...clientErrors }
  const message = (field: string) => (all[field] ? fieldErrorMessage(t, all[field]) : null)
  const formError = error && Object.keys(serverErrors).length === 0 ? apiErrorMessage(t, error) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) {
      setClientErrors({ title: { field: 'title', code: 'missing' } })
      return titleRef.current?.focus()
    }
    setClientErrors({})
    onSubmit({ title, body_md: body, project_id: projectId, tags })
  }

  return (
    <form className="grid max-w-5xl grid-cols-1 gap-6" onSubmit={submit} noValidate>
      <FormField
        ref={titleRef}
        id="title"
        label={t('notes.form.title')}
        error={message('title')}
        maxLength={300}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SearchSelect
          id="project_id"
          label={t('notes.form.project')}
          searchLabel={t('notes.form.projectSearch')}
          noneLabel={t('notes.noProject')}
          value={projectId}
          options={projects?.items ?? []}
          currentName={initial?.project_name}
          search={search}
          onSearch={setSearch}
          onChange={setProjectId}
          error={message('project_id')}
        />
        <TagInput id="tags" tags={tags} onChange={setTags} error={message('tags')} />
      </div>
      <MarkdownEditor
        id="body_md"
        label={t('notes.form.body')}
        value={body}
        onChange={setBody}
        maxLength={MAX_BODY_CHARS}
        error={message('body_md')}
      />
      {(formError || Object.keys(all).length > 0) && (
        <p role="alert" className="text-danger text-sm">
          {formError ?? t('errors.validation')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('notes.form.saving') : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
