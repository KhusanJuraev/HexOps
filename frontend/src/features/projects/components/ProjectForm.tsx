import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { FieldError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { DateInput } from '@/shared/components/DateInput'
import { FormField } from '@/shared/components/FormField'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'
import { Textarea } from '@/shared/ui/textarea'

import { PROJECT_STATUSES, PROJECT_TYPES, type Project, type ProjectInput } from '../types'
import { ScopeEditor, type ScopeRow } from './ScopeEditor'

interface Props {
  initial?: Project
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (input: ProjectInput) => void
  onCancel: () => void
}

/** Same rules as the backend where they are cheap to check; the server decides the rest. */
function validate(name: string, rows: ScopeRow[]): Record<string, FieldError> {
  const errors: Record<string, FieldError> = {}
  if (!name.trim()) errors.name = { field: 'name', code: 'missing' }
  rows.forEach((row, i) => {
    const field = `scope.${i}.value`
    if (!row.value) errors[field] = { field, code: 'missing' }
    else if (row.value !== row.value.trim()) errors[field] = { field, code: 'scope_value_whitespace' }
  })
  return errors
}

export function ProjectForm({ initial, submitLabel, pending, error, onSubmit, onCancel }: Props) {
  const { t } = useTranslation()
  // Row keys: 0..n-1 for the initial rows, then counting up for new ones.
  const nextKey = useRef(initial?.scope.length ?? 0)
  const newKey = () => nextKey.current++
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<ProjectInput['type']>(initial?.type ?? 'bounty_program')
  const [status, setStatus] = useState<ProjectInput['status']>(initial?.status ?? 'active')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [startDateError, setStartDateError] = useState<string | null>(null)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [rows, setRows] = useState<ScopeRow[]>(() => (initial?.scope ?? []).map((s, key) => ({ ...s, key })))
  const [clientErrors, setClientErrors] = useState<Record<string, FieldError>>({})
  const nameRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const serverErrors = fieldErrorsOf(error)
  // Client errors are recomputed on submit; server errors belong to the last attempt.
  const all = { ...serverErrors, ...clientErrors }
  const message = (field: string) => (all[field] ? fieldErrorMessage(t, all[field]) : null)
  const scopeErrors = Object.fromEntries(rows.map((_, i) => [i, message(`scope.${i}.value`) ?? undefined]))
  const listError = message('scope')
  const formError = error && Object.keys(serverErrors).length === 0 ? apiErrorMessage(t, error) : null

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errors = validate(name, rows)
    setClientErrors(errors)
    if (errors.name) return nameRef.current?.focus()
    if (startDateError) return formRef.current?.querySelector<HTMLInputElement>('#start_date')?.focus()
    if (Object.keys(errors).length) {
      const first = Object.keys(errors)[0].split('.')[1]
      formRef.current?.querySelectorAll<HTMLInputElement>('[data-scope-value]')[Number(first)]?.focus()
      return
    }
    onSubmit({
      name,
      type,
      status,
      start_date: startDate || null,
      description,
      scope: rows.map(({ kind, value, note }) => ({ kind, value, note })),
    })
  }

  return (
    <form ref={formRef} className="grid max-w-3xl grid-cols-1 gap-6" onSubmit={submit} noValidate>
      <FormField
        ref={nameRef}
        id="name"
        label={t('projects.form.name')}
        error={message('name')}
        maxLength={200}
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setClientErrors(({ name: _removed, ...rest }) => rest)
        }}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="type">{t('projects.form.type')}</Label>
          <NativeSelect id="type" value={type} onChange={(e) => setType(e.target.value as ProjectInput['type'])}>
            {PROJECT_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`projects.type.${v}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="status">{t('projects.form.status')}</Label>
          <NativeSelect id="status" value={status} onChange={(e) => setStatus(e.target.value as ProjectInput['status'])}>
            {PROJECT_STATUSES.map((v) => (
              <option key={v} value={v}>
                {t(`projects.status.${v}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="start_date">{t('projects.form.startDate')}</Label>
          <DateInput id="start_date" value={startDate} onChange={setStartDate} onErrorChange={setStartDateError} error={message('start_date')} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="description">{t('projects.form.description')}</Label>
        <Textarea
          id="description"
          rows={5}
          maxLength={10_000}
          aria-describedby="description-hint"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <p id="description-hint" className="text-muted-foreground text-xs">
          {message('description') ?? t('projects.form.descriptionHint')}
        </p>
      </div>
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-1 text-sm font-medium">{t('projects.form.scope')}</legend>
        <p className="text-muted-foreground -mt-1 text-xs">{t('projects.form.scopeHint')}</p>
        <ScopeEditor
          rows={rows}
          newKey={newKey}
          errors={scopeErrors}
          onChange={(next) => {
            setRows(next)
            setClientErrors({})
          }}
        />
        {listError && <p className="text-danger text-sm">{listError}</p>}
      </fieldset>
      {formError && (
        <p role="alert" className="text-danger text-sm">
          {formError}
        </p>
      )}
      {Object.keys(all).length > 0 && !formError && (
        <p role="alert" className="text-danger text-sm">
          {t('errors.validation')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('projects.form.saving') : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
