import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { FieldError } from '@/shared/api/client'
import { apiErrorMessage, fieldErrorMessage, fieldErrorsOf } from '@/shared/api/errors'
import { FormField } from '@/shared/components/FormField'
import { MarkdownEditor } from '@/shared/components/markdown'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { NativeSelect } from '@/shared/ui/native-select'

import { ratingForScore } from '../cvss'
import { MAX_BODY_CHARS, REPORT_TYPES, SEVERITIES, type Report, type ReportInput } from '../types'
import { ProjectSelect } from './ProjectSelect'

interface Props {
  initial?: Report
  initialProjectId?: number | null
  /** A new report prefilled from an imported PDF draft (Stage 7); it counts as unsaved. */
  draft?: { title: string; body_md: string }
  submitLabel: string
  pending: boolean
  error: unknown
  onSubmit: (input: ReportInput) => void
  onCancel: () => void
  /** Called with true while the form differs from what was loaded. */
  onDirtyChange?: (dirty: boolean) => void
}

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim())

export function ReportForm({ initial, initialProjectId, draft, submitLabel, pending, error, onSubmit, onCancel, onDirtyChange }: Props) {
  const { t } = useTranslation()
  const [projectId, setProjectId] = useState<number | null>(initial?.project_id ?? initialProjectId ?? null)
  const [title, setTitle] = useState(initial?.title ?? draft?.title ?? '')
  const [type, setType] = useState<ReportInput['type']>(initial?.type ?? 'bbp')
  const [severity, setSeverity] = useState<ReportInput['severity']>(initial?.severity ?? 'medium')
  const [cvssScore, setCvssScore] = useState(initial?.cvss_score ?? '')
  const [cvssVector, setCvssVector] = useState(initial?.cvss_vector ?? '')
  const [body, setBody] = useState(initial?.body_md ?? draft?.body_md ?? '')
  const [amount, setAmount] = useState(initial?.bounty_amount ?? '')
  const [currency, setCurrency] = useState(initial?.bounty_currency ?? '')
  const [clientErrors, setClientErrors] = useState<Record<string, FieldError>>({})
  const titleRef = useRef<HTMLInputElement>(null)

  // Everything the user can change, compared with what was loaded. An imported draft
  // is compared with an empty form, so leaving it unsaved asks for confirmation.
  const snapshot = JSON.stringify([projectId, title, type, severity, cvssScore, cvssVector, body, amount, currency])
  const [initialSnapshot] = useState(() =>
    draft ? JSON.stringify([projectId, '', type, severity, cvssScore, cvssVector, '', amount, currency]) : snapshot,
  )
  const dirty = snapshot !== initialSnapshot
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const all = { ...fieldErrorsOf(error), ...clientErrors }
  const message = (field: string) => (all[field] ? fieldErrorMessage(t, all[field]) : null)
  const serverFieldErrors = Object.keys(fieldErrorsOf(error)).length > 0
  const formError = error && !serverFieldErrors ? apiErrorMessage(t, error) : null
  const suggested = ratingForScore(cvssScore)
  const isBbp = type === 'bbp'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const errors: Record<string, FieldError> = {}
    if (!title.trim()) errors.title = { field: 'title', code: 'missing' }
    if (projectId === null) errors.project_id = { field: 'project_id', code: 'missing' }
    setClientErrors(errors)
    if (errors.title) return titleRef.current?.focus()
    if (errors.project_id) return document.getElementById('project_id')?.focus()
    onSubmit({
      project_id: projectId!,
      title,
      type,
      severity,
      cvss_score: blankToNull(cvssScore),
      cvss_vector: blankToNull(cvssVector),
      body_md: body,
      // A bounty belongs to BBP reports only; switching type away drops it.
      bounty_amount: isBbp ? blankToNull(amount) : null,
      bounty_currency: isBbp ? blankToNull(currency)?.toUpperCase() ?? null : null,
    })
  }

  return (
    <form className="grid max-w-3xl grid-cols-1 gap-6" onSubmit={submit} noValidate>
      <FormField
        ref={titleRef}
        id="title"
        label={t('reports.form.title')}
        error={message('title')}
        maxLength={300}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <ProjectSelect
        id="project_id"
        value={projectId}
        currentName={initial?.project_name}
        error={message('project_id')}
        onChange={setProjectId}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="type">{t('reports.form.type')}</Label>
          <NativeSelect
            id="type"
            value={type}
            aria-invalid={message('type') ? true : undefined}
            aria-describedby={message('type') ? 'type-error' : undefined}
            onChange={(e) => setType(e.target.value as ReportInput['type'])}
          >
            {REPORT_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`reports.type.${v}`)}
              </option>
            ))}
          </NativeSelect>
          {message('type') && (
            <p id="type-error" className="text-danger text-sm">
              {message('type')}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="severity">{t('reports.form.severity')}</Label>
          <NativeSelect
            id="severity"
            value={severity}
            aria-describedby="severity-hint"
            onChange={(e) => setSeverity(e.target.value as ReportInput['severity'])}
          >
            {SEVERITIES.map((v) => (
              <option key={v} value={v}>
                {t(`reports.severity.${v}`)}
              </option>
            ))}
          </NativeSelect>
          <p id="severity-hint" className="text-muted-foreground text-xs">
            {t('reports.form.severityHint')}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <FormField
          id="cvss_score"
          label={t('reports.form.cvssScore')}
          inputMode="decimal"
          maxLength={4}
          error={message('cvss_score')}
          value={cvssScore}
          onChange={(e) => setCvssScore(e.target.value)}
        />
        <FormField
          id="cvss_vector"
          label={t('reports.form.cvssVector')}
          className="font-mono"
          maxLength={200}
          autoCapitalize="characters"
          spellCheck={false}
          error={message('cvss_vector')}
          value={cvssVector}
          onChange={(e) => setCvssVector(e.target.value)}
        />
      </div>
      {suggested && (
        <p className="text-muted-foreground -mt-3 text-sm" aria-live="polite">
          {t('reports.form.cvssSuggests', { score: cvssScore, rating: t(`reports.severity.${suggested}`) })}{' '}
          {suggested !== severity && <span className="text-warning">{t('reports.form.cvssDiffers')}</span>}
        </p>
      )}
      <MarkdownEditor
        id="body_md"
        label={t('reports.form.body')}
        value={body}
        onChange={setBody}
        maxLength={MAX_BODY_CHARS}
        error={message('body_md')}
        hint={t('reports.form.bodyHint')}
      />
      <fieldset className="grid min-w-0 grid-cols-1 gap-3">
        <legend className="mb-1 text-sm font-medium">{t('reports.form.bounty')}</legend>
        {isBbp ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id="bounty_amount"
              label={t('reports.form.bountyAmount')}
              inputMode="decimal"
              maxLength={16}
              error={message('bounty_amount')}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <FormField
              id="bounty_currency"
              label={t('reports.form.bountyCurrency')}
              maxLength={3}
              autoCapitalize="characters"
              error={message('bounty_currency')}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">{t('reports.form.bountyOnlyBbp')}</p>
        )}
      </fieldset>
      {(formError || Object.keys(all).length > 0) && (
        <p role="alert" className="text-danger text-sm">
          {formError ?? t('errors.validation')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? t('reports.form.saving') : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
